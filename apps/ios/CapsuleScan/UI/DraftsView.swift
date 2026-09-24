import SwiftUI
import SwiftData

@MainActor struct DraftsView: View {
    @EnvironmentObject private var services: AppServices
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \WardrobeItem.createdAt, order: .reverse) private var items: [WardrobeItem]
    private var drafts: [WardrobeItem] {
        items.filter { !$0.record.capsuleSaveState.completed && ($0.capsuleUserID == nil || $0.capsuleUserID == services.user?.id) }
    }
    var body: some View {
        ScrollView {
            if drafts.isEmpty {
                VStack(spacing: 12) {
                    Text("no drafts").font(CapsuleStyle.heading)
                    Text("unfinished scans appear here.").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                    Button("add an item") { dismiss() }.frame(minHeight: 44).buttonStyle(.plain)
                }.frame(maxWidth: .infinity).padding(.top, 48)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 16)], spacing: 24) {
                    ForEach(drafts) { item in
                        NavigationLink {
                            ItemEditorView(model: ItemEditorModel(record: item.record, services: services))
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                LocalImage(reference: item.localImageReference, media: services.media)
                                    .aspectRatio(3 / 4, contentMode: .fit).clipped()
                                Text(item.name.isEmpty ? "untitled item" : item.name).font(CapsuleStyle.body).lineLimit(2)
                                Text(item.category ?? "uncategorized").font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                                Text(item.record.capsuleSaveState.label).font(CapsuleStyle.caption).foregroundStyle(CapsuleStyle.secondary)
                            }.foregroundStyle(CapsuleStyle.text)
                        }.buttonStyle(.plain)
                    }
                }.padding(.horizontal, 20).padding(.vertical, 24)
            }
        }
        .capsuleScreen()
        .navigationTitle("drafts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { Text("drafts").font(CapsuleStyle.heading) }
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { SettingsView() } label: { Image(systemName: "gearshape").font(.system(size: 15)).frame(width: 44, height: 44) }.accessibilityLabel("settings")
            }.quietBackground()
        }
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
