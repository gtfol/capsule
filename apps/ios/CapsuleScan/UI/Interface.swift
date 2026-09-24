import SwiftUI

// Native controls with capsule's type, spacing, and monochrome palette.
enum CapsuleStyle {
    static let canvas = Color.black
    static let text = Color(white: 238 / 255)
    static let secondary = Color(white: 170 / 255)
    static let divider = Color(white: 44 / 255)
    static let body = Font.custom("Lato-Regular", size: 15, relativeTo: .subheadline)
    static let heading = Font.custom("Lato-Regular", size: 17, relativeTo: .headline)
    static let caption = Font.custom("Lato-Regular", size: 13, relativeTo: .footnote)
}

extension View {
    func capsuleScreen() -> some View {
        font(CapsuleStyle.body)
            .foregroundStyle(CapsuleStyle.text)
            .tint(CapsuleStyle.text)
            .background(CapsuleStyle.canvas)
            .toolbarBackground(CapsuleStyle.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }

    func capsulePrimaryAction() -> some View {
        buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 2))
            .controlSize(.large)
            .tint(CapsuleStyle.text)
            .foregroundStyle(CapsuleStyle.canvas)
    }
}

extension ToolbarContent {
    @ToolbarContentBuilder func quietBackground() -> some ToolbarContent {
        if #available(iOS 26.0, *) { sharedBackgroundVisibility(.hidden) }
        else { self }
    }
}

struct InfoButton: View {
    let title: String
    let paragraphs: [String]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showingInfo = false

    var body: some View {
        Button { showingInfo = true } label: {
            Image(systemName: "info.circle")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(CapsuleStyle.secondary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("about \(title)")
        .accessibilityHint("opens more information")
        .popover(isPresented: $showingInfo, arrowEdge: .top) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text(title).font(CapsuleStyle.heading)
                        Spacer(minLength: 8)
                        Button { showingInfo = false } label: {
                            Image(systemName: "xmark").font(.system(size: 12))
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("close information")
                    }
                    ForEach(paragraphs, id: \.self) { paragraph in
                        Text(paragraph).font(CapsuleStyle.caption)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }.padding(20)
            }
            .frame(idealWidth: dynamicTypeSize.isAccessibilitySize ? nil : 280,
                   maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 320,
                   idealHeight: dynamicTypeSize.isAccessibilitySize ? nil : 260,
                   maxHeight: dynamicTypeSize.isAccessibilitySize ? .infinity : 420)
            .foregroundStyle(CapsuleStyle.text)
            .presentationCompactAdaptation(dynamicTypeSize.isAccessibilitySize ? .sheet : .popover)
            .preferredColorScheme(.dark)
        }
    }
}
