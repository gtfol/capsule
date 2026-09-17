import SwiftUI
import SwiftData

@MainActor struct DraftsView: View {
    @EnvironmentObject private var services: AppServices
    @Query(sort: \WardrobeItem.createdAt, order: .reverse) private var items: [WardrobeItem]
    private var drafts: [WardrobeItem] {
        items.filter { !$0.record.capsuleSaveState.completed && ($0.capsuleUserID == nil || $0.capsuleUserID == services.user?.id) }
    }
    var body: some View {
        ScrollView {
            if drafts.isEmpty {
                ContentUnavailableView("no drafts", systemImage: "tray", description: Text("unfinished scans appear here."))
                    .padding(.top, 60)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 16)], spacing: 24) {
                    ForEach(drafts) { item in
                        NavigationLink {
                            ItemEditorView(model: ItemEditorModel(record: item.record, services: services))
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                LocalImage(reference: item.localImageReference, media: services.media)
                                    .aspectRatio(3 / 4, contentMode: .fit).clipped()
                                Text(item.name.isEmpty ? "untitled item" : item.name).font(.subheadline).lineLimit(2)
                                Text(item.category ?? "uncategorized").font(.caption).foregroundStyle(.secondary)
                                Text(item.record.capsuleSaveState.label).font(.caption2).foregroundStyle(.secondary)
                            }.foregroundStyle(.primary)
                        }.buttonStyle(.plain)
                    }
                }.padding(16)
            }
        }
        .navigationTitle("drafts")
        .toolbar { NavigationLink { SettingsView() } label: { Image(systemName: "gearshape") }.accessibilityLabel("settings") }
    }
}

private struct LocalImage: View {
    let reference: String
    let media: any MediaStoring
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            Color(.secondarySystemBackground)
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else { Image(systemName: "tshirt").foregroundStyle(.secondary).accessibilityLabel("garment photo") }
        }
        .task(id: reference) {
            if let data = try? await media.read(reference) { image = UIImage(data: data) }
        }
    }
}
