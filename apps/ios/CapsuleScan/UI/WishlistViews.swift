import SwiftUI
import Charts

struct RatingStars: View {
    var rating: Decimal?
    var body: some View {
        HStack(spacing: 3) {
            ForEach(1...5, id: \.self) { star in
                Image(systemName: (rating ?? 0) >= Decimal(star) ? "star.fill" : (rating ?? 0) >= Decimal(star) - Decimal(string: "0.5")! ? "star.leadinghalf.filled" : "star")
            }
        }.foregroundStyle(CapsuleStyle.secondary).accessibilityElement(children: .ignore)
            .accessibilityLabel(rating.map { "\(NSDecimalNumber(decimal: $0).stringValue) out of 5 stars" } ?? "not rated")
    }
}
struct RatingPicker: View {
    @Binding var rating: Decimal?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("rating").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
            HStack(spacing: 0) {
                ForEach(1...5, id: \.self) { star in
                    Image(systemName: (rating ?? 0) >= Decimal(star) ? "star.fill" : (rating ?? 0) >= Decimal(star) - Decimal(string: "0.5")! ? "star.leadinghalf.filled" : "star")
                        .font(.system(size: 21)).frame(width: 44, height: 44).contentShape(Rectangle())
                        .onTapGesture(coordinateSpace: .local) { location in
                            let value = Decimal(star) - (location.x < 22 ? Decimal(string: "0.5")! : 0)
                            rating = rating == value ? nil : value
                        }
                }
                Spacer(minLength: 0)
            }.accessibilityElement(children: .ignore).accessibilityLabel("rating")
                .accessibilityValue(rating.map { "\(NSDecimalNumber(decimal: $0).stringValue) out of 5 stars" } ?? "not rated")
                .accessibilityAdjustableAction { direction in
                    if direction == .increment { rating = min(5, (rating ?? 0) + Decimal(string: "0.5")!) }
                    else { let value = (rating ?? 0) - Decimal(string: "0.5")!; rating = value > 0 ? value : nil }
                }
                .accessibilityAction(named: "clear rating") { rating = nil }
        }
    }
}

@MainActor struct WishlistPrices: View {
    @ObservedObject var model: WardrobeDetailModel
    @State private var addingLink = false
    @State private var alternative = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            WishlistPriceChart(item: model.item)
            if model.hasChanges { Text("save changes before checking prices or moving this piece.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary) }
            ForEach(model.item.sources ?? [], id: \.url) { source in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        if let url = URL(string: source.url) {
                            Link(WishlistDisplay.source(source.url), destination: url).font(CapsuleStyle.body)
                        }
                        HStack(spacing: 8) {
                            Text(WishlistDisplay.price(source.price, currency: source.currency))
                            if source.url == model.item.currentSourceUrl { Image(systemName: "checkmark").accessibilityLabel("current price") }
                            if source.link_broken { Text("link unavailable") }
                        }.font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    }
                    Spacer(minLength: 0)
                    Button { Task { await model.checkPrice(url: source.url) } } label: {
                        Image(systemName: "arrow.clockwise").font(.system(size: 14)).frame(width: 44, height: 44)
                    }.accessibilityLabel("refetch price from \(WishlistDisplay.source(source.url))").disabled(unavailable)
                }
            }
            Button("add alternative link") { addingLink = true }.font(CapsuleStyle.caption).frame(minHeight: 44).disabled(unavailable)
        }
        .alert("add listing", isPresented: $addingLink) {
            TextField("https://", text: $alternative).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("add and check price") { let url = alternative.trimmingCharacters(in: .whitespacesAndNewlines); alternative = ""; Task { await model.checkPrice(url: url) } }
            Button("cancel", role: .cancel) { alternative = "" }
        }
    }
    private var unavailable: Bool { model.busy || model.processing || model.hasChanges }
}

struct WishlistPriceChart: View {
    let item: RemoteWardrobeItem
    @State private var currency = ""
    @State private var selection: Date?
    private var currencies: [String] { Array(Set((item.priceHistory ?? []).map(\.currency) + [item.currency])).sorted() }
    private var selectedCurrency: String { currencies.contains(currency) ? currency : item.currency }
    private var entries: [WishlistPrice] { (item.priceHistory ?? []).filter { $0.currency == selectedCurrency }.sorted { $0.fetched_at < $1.fetched_at } }
    private func date(_ entry: WishlistPrice) -> Date { Date(timeIntervalSince1970: entry.fetched_at / 1000) }
    private var selected: WishlistPrice? {
        guard let selection else { return nil }
        return entries.min { abs(date($0).timeIntervalSince(selection)) < abs(date($1).timeIntervalSince(selection)) }
    }
    private var displayedQuote: WishlistPrice? { selected ?? (selectedCurrency == item.currency ? nil : entries.last) }
    private var domain: ClosedRange<Date> {
        let start = entries.first.map(date) ?? Date()
        let end = entries.last.map(date) ?? start
        let padding = max(3600, end.timeIntervalSince(start) * 0.08)
        return start.addingTimeInterval(-padding)...end.addingTimeInterval(padding)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("price history").font(CapsuleStyle.body)
                Spacer()
                if currencies.count > 1 {
                    Picker("currency", selection: $currency) { ForEach(currencies, id: \.self) { Text($0.isEmpty ? "unknown" : $0).tag($0) } }.labelsHidden()
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(displayedQuote.map { WishlistDisplay.price($0.price, currency: $0.currency) } ?? WishlistDisplay.price(item.price, currency: item.currency)).font(CapsuleStyle.heading)
                Text(displayedQuote.map { "\(date($0).formatted(date: .abbreviated, time: .shortened)) · \(WishlistDisplay.source($0.source_url))" } ?? "current price")
                    .font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).lineLimit(2).frame(minHeight: 32, alignment: .top)
            }
            if entries.isEmpty {
                Text("check a listing to record its price.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary).frame(height: 100)
            } else {
                Chart {
                    ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                        PointMark(x: .value("date", date(entry)), y: .value("price", NSDecimalNumber(decimal: entry.price).doubleValue))
                            .foregroundStyle(CapsuleStyle.text).symbol(by: .value("listing", entry.source_url)).symbolSize(35)
                            .accessibilityLabel("\(WishlistDisplay.source(entry.source_url)), \(date(entry).formatted(date: .abbreviated, time: .shortened))")
                            .accessibilityValue(WishlistDisplay.price(entry.price, currency: entry.currency))
                    }
                    if let selected {
                        RuleMark(x: .value("date", date(selected))).foregroundStyle(CapsuleStyle.secondary.opacity(0.4))
                        PointMark(x: .value("date", date(selected)), y: .value("price", NSDecimalNumber(decimal: selected.price).doubleValue)).symbolSize(80).foregroundStyle(CapsuleStyle.text)
                    }
                }.chartXScale(domain: domain).chartYScale(domain: .automatic(includesZero: false))
                    .chartXSelection(value: $selection).chartLegend(.hidden)
                    .chartXAxis {
                        AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                            AxisGridLine().foregroundStyle(CapsuleStyle.divider)
                            AxisValueLabel().foregroundStyle(CapsuleStyle.secondary)
                        }
                    }
                    .chartYAxis {
                        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                            AxisGridLine().foregroundStyle(CapsuleStyle.divider)
                            AxisValueLabel().foregroundStyle(CapsuleStyle.secondary)
                        }
                    }.frame(height: 160)
            }
        }.onAppear { currency = item.currency }.onChange(of: currency) { _, _ in selection = nil }
    }
}
