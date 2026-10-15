import SwiftUI
import WebKit

private enum Website {
    static let url: URL = {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "VulithubaWebsiteURL") as? String,
           let url = URL(string: configured), url.scheme == "https", url.host != nil {
            return url.appending(path: "index.html")
        }
    #if targetEnvironment(simulator) || os(macOS)
        return URL(string: "http://127.0.0.1:3000/index.html")!
    #else
    // Keep the iPhone and this Mac on the same Wi-Fi during development.
        return URL(string: "http://192.168.0.3:3000/index.html")!
    #endif
    }()
}

struct ContentView: View {
    @State private var loadError: String?
    @State private var reloadID = UUID()

    var body: some View {
        ZStack {
            WebsiteView(url: Website.url, loadError: $loadError)
                .id(reloadID)
            if let loadError {
                VStack(spacing: 16) {
                    Text("Unable to load Vulithuba")
                        .font(.headline)
                    Text(loadError)
                        .multilineTextAlignment(.center)
                    Text("Keep your iPhone and Mac on the same Wi-Fi and make sure the server is running.")
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                    Button("Try again") {
                        self.loadError = nil
                        reloadID = UUID()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.background)
            }
        }
    }
}

#if os(macOS)
private typealias WebsiteRepresentable = NSViewRepresentable
#else
private typealias WebsiteRepresentable = UIViewRepresentable
#endif

private struct WebsiteView: WebsiteRepresentable {
    let url: URL
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(loadError: $loadError)
    }

    private func makeWebView(coordinator: Coordinator) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView {
        makeWebView(coordinator: context.coordinator)
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}
    #else
    func makeUIView(context: Context) -> WKWebView {
        makeWebView(coordinator: context.coordinator)
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
    #endif

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        @Binding var loadError: String?

        init(loadError: Binding<String?>) {
            _loadError = loadError
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        private func report(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            loadError = error.localizedDescription
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }
    }
}
