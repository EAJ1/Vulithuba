import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:my_mobile_app/main.dart';
import 'package:my_mobile_app/website_browser.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Live website content, plan signup, login API, and recovery', (
    tester,
  ) async {
    final controller = WebViewController();
    final browser = WebViewWebsiteBrowser(controller: controller);
    final base = websiteBaseUrl();
    await tester.pumpWidget(VulithubaApp(browser: browser, baseUrl: base));

    Future<void> waitFor(String expression) async {
      final deadline = DateTime.now().add(const Duration(seconds: 60));
      while (DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 200));
        try {
          final result = await controller
              .runJavaScriptReturningResult(expression)
              .timeout(const Duration(seconds: 3));
          if (result == true) return;
        } catch (_) {
          // Platform creation and document navigation may temporarily prevent
          // JavaScript evaluation. Keep pumping frames while waiting.
        }
      }
      fail('Timed out waiting for website condition: $expression');
    }

    await waitFor(
      "document.querySelector('#mobile-dashboard') !== null && document.querySelector('#guest-actions')?.hidden === false",
    );
    expect(find.text('Unable to load Vulithuba'), findsNothing);

    // Exercise native touch delivery instead of invoking links from JavaScript.
    await controller.runJavaScript('window.scrollTo(0, 0)');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.drag(find.byType(WebViewWidget), const Offset(0, -260));
    await waitFor('window.scrollY > 0');
    await controller.runJavaScript('window.scrollTo(0, 0)');
    await tester.pump(const Duration(milliseconds: 300));
    Future<double> coordinate(String expression) async {
      final value = await controller.runJavaScriptReturningResult(expression);
      return double.parse(value.toString().replaceAll('"', ''));
    }

    final linkX = await coordinate(
      "(() => { const r = document.querySelector('#guest-actions a').getBoundingClientRect(); return r.left + r.width / 2; })()",
    );
    final linkY = await coordinate(
      "(() => { const r = document.querySelector('#guest-actions a').getBoundingClientRect(); return r.top + r.height / 2; })()",
    );
    await tester.tapAt(
      tester.getTopLeft(find.byType(WebViewWidget)) + Offset(linkX, linkY),
    );
    await waitFor("document.querySelector('#loginForm') !== null");

    await tester.tap(find.widgetWithText(NavigationDestination, 'Services'));
    await tester.pump();
    await waitFor(
      "location.hash === '#services' && document.body.innerText.includes('Home Fibre') && document.body.innerText.includes('Business Networks') && getComputedStyle(document.querySelector('.site-header')).display === 'none'",
    );

    await tester.tap(find.widgetWithText(NavigationDestination, 'Plans'));
    await tester.pump();
    await waitFor(
      "location.hash === '#plans' && document.body.innerText.includes('R399') && document.body.innerText.includes('Family Plus') && document.body.innerText.includes('Office Pro')",
    );
    await controller.runJavaScript(
      "document.querySelector('a[href*=\"signup.html?plan=Family\"]').click()",
    );
    await waitFor(
      "location.pathname === '/signup.html' && document.querySelector('#plan')?.value === 'Family Plus'",
    );

    await tester.tap(find.widgetWithText(NavigationDestination, 'Support'));
    await tester.pump();
    await waitFor(
      "location.hash === '#contact' && document.querySelector('.contact-form') !== null",
    );

    await tester.tap(find.widgetWithText(NavigationDestination, 'Account'));
    await tester.pump();
    await waitFor("document.querySelector('#loginForm') !== null");
    await controller.runJavaScript("""
      document.querySelector('#username').value = 'vulithuba-mobile-smoke-nonexistent';
      document.querySelector('#password').value = 'incorrect-smoke-password';
      document.querySelector('#loginForm').requestSubmit();
    """);
    await waitFor(
      "document.body.innerText.includes('Invalid username or password.')",
    );
    expect(
      tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
      4,
    );

    // A closed port checks the actual platform's main-frame error callback.
    await controller.loadRequest(
      Uri.parse('http://127.0.0.1:59999/index.html'),
    );
    await tester.pump(const Duration(seconds: 2));
    final deadline = DateTime.now().add(const Duration(seconds: 15));
    while (find.text('Unable to load Vulithuba').evaluate().isEmpty &&
        DateTime.now().isBefore(deadline)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(find.text('Unable to load Vulithuba'), findsOneWidget);
    await tester.tap(find.text('Go to home'));
    await tester.pump();
    await waitFor(
      "location.origin === '${base.origin}' && document.querySelector('#mobile-dashboard') !== null",
    );
    expect(find.text('Unable to load Vulithuba'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
