import Foundation

enum WishlistSort: String, CaseIterable, Identifiable {
    case recent = "recently added", rating = "rating", drop = "biggest price drop"
    var id: String { rawValue }
    func sorted(_ items: [RemoteWardrobeItem]) -> [RemoteWardrobeItem] {
        items.sorted { a, b in
            switch self {
            case .rating:
                if a.rating != b.rating { return (a.rating ?? -1) > (b.rating ?? -1) }
            case .drop:
                if a.priceDrop != b.priceDrop { return (a.priceDrop ?? -Decimal.greatestFiniteMagnitude) > (b.priceDrop ?? -Decimal.greatestFiniteMagnitude) }
            case .recent: break
            }
            return a.createdAt == b.createdAt ? a.id < b.id : a.createdAt > b.createdAt
        }
    }
}
enum WishlistDisplay {
    static func price(_ price: String, currency: String) -> String {
        guard let amount = Decimal(string: price, locale: Locale(identifier: "en_US_POSIX")), !price.isEmpty else { return "—" }
        return self.price(amount, currency: currency)
    }
    static func price(_ amount: Decimal, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = currency.isEmpty ? .decimal : .currency
        formatter.currencyCode = currency
        return formatter.string(from: NSDecimalNumber(decimal: amount)) ?? "—"
    }
    static func source(_ url: String) -> String { URL(string: url)?.host()?.replacingOccurrences(of: "www.", with: "") ?? "listing" }
}
