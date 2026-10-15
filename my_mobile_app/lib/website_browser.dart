import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

class BrowserCallbacks {
  const BrowserCallbacks({
    required this.onStarted,
    required this.onFinished,
    required this.onProgress,
    required this.onError,
    required this.onUrlChanged,
    required this.onConfirm,
    required this.onAlert,
  });

  final void Function(String) onStarted;
  final void Function(String) onFinished;
  final void Function(int) onProgress;
  final void Function(String) onError;
  final void Function(String) onUrlChanged;
  final Future<bool> Function(String) onConfirm;
  final Future<void> Function(String) onAlert;
}

abstract class WebsiteBrowser {
  Widget get view;
  Future<void> initialize(BrowserCallbacks callbacks);
  Future<void> load(Uri url);
  Future<bool> canGoBack();
  Future<void> goBack();
}

class WebViewWebsiteBrowser implements WebsiteBrowser {
  WebViewWebsiteBrowser({WebViewController? controller})
    : _controller = controller ?? WebViewController();

  final WebViewController _controller;
  Uri? _pageUrl;
  String? _websiteOrigin;
  late final Widget _view = _createView();

  @override
  Widget get view => _view;

  Widget _createView() {
    final gestures = <Factory<OneSequenceGestureRecognizer>>{
      Factory<OneSequenceGestureRecognizer>(EagerGestureRecognizer.new),
    };
    if (_controller.platform is AndroidWebViewController) {
      return WebViewWidget.fromPlatformCreationParams(
        params: AndroidWebViewWidgetCreationParams(
          controller: _controller.platform,
          gestureRecognizers: gestures,
          displayWithHybridComposition: true,
        ),
      );
    }
    return WebViewWidget(controller: _controller, gestureRecognizers: gestures);
  }

  @override
  Future<void> initialize(BrowserCallbacks callbacks) async {
    await _controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await _controller.setBackgroundColor(const Color(0xfff4f8ff));
    await _controller.setOnJavaScriptConfirmDialog(
      (request) => callbacks.onConfirm(request.message),
    );
    await _controller.setOnJavaScriptAlertDialog(
      (request) => callbacks.onAlert(request.message),
    );
    await _controller.setNavigationDelegate(
      NavigationDelegate(
        onPageStarted: (url) {
          _pageUrl = Uri.parse(url).replace(fragment: '');
          callbacks.onStarted(url);
        },
        onPageFinished: callbacks.onFinished,
        onProgress: callbacks.onProgress,
        onUrlChange: (change) {
          if (change.url != null) callbacks.onUrlChanged(change.url!);
        },
        onWebResourceError: (error) {
          // A missing font or image should not replace a functioning page.
          if (error.isForMainFrame == true) {
            callbacks.onError('The page could not be loaded.');
          }
        },
        onHttpError: (error) {
          if (error.request?.uri.replace(fragment: '') == _pageUrl &&
              _pageUrl != null) {
            callbacks.onError('The server could not load this page.');
          }
        },
        onNavigationRequest: (request) async {
          final url = Uri.tryParse(request.url);
          if (url == null) return NavigationDecision.prevent;
          if (url.scheme == 'http' || url.scheme == 'https') {
            if (url.origin == _websiteOrigin &&
                (url.path.endsWith('.html') || url.path == '/') &&
                url.queryParameters['mobile'] != '1') {
              await _controller.loadRequest(
                url.replace(
                  queryParameters: {...url.queryParameters, 'mobile': '1'},
                ),
              );
              return NavigationDecision.prevent;
            }
            // Keep checkout and its return URL in this WebView, preserving the
            // website's authenticated session throughout the payment flow.
            return NavigationDecision.navigate;
          }
          if (['tel', 'mailto', 'sms'].contains(url.scheme)) {
            try {
              if (!await launchUrl(url, mode: LaunchMode.externalApplication)) {
                await callbacks.onAlert(
                  'No app is available to open this link.',
                );
              }
            } catch (_) {
              await callbacks.onAlert(
                'Unable to open this link on this device.',
              );
            }
          }
          return NavigationDecision.prevent;
        },
      ),
    );
  }

  @override
  Future<void> load(Uri url) {
    _websiteOrigin ??= url.origin;
    return _controller.loadRequest(url);
  }

  @override
  Future<bool> canGoBack() => _controller.canGoBack();

  @override
  Future<void> goBack() => _controller.goBack();
}
