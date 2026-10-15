import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_mobile_app/main.dart';
import 'package:my_mobile_app/website_browser.dart';

class FakeWebsiteBrowser implements WebsiteBrowser {
  late BrowserCallbacks callbacks;
  final List<Uri> requests = [];
  bool fail = false;
  bool hashOnly = false;

  @override
  Widget get view => const SizedBox(key: Key('website'));

  @override
  Future<void> initialize(BrowserCallbacks callbacks) async {
    this.callbacks = callbacks;
  }

  @override
  Future<void> load(Uri url) async {
    requests.add(url);
    if (hashOnly) {
      callbacks.onUrlChanged(url.toString());
      return;
    }
    callbacks.onStarted(url.toString());
    if (fail) {
      callbacks.onError('The page could not be loaded.');
    } else {
      callbacks.onFinished(url.toString());
    }
  }

  @override
  Future<bool> canGoBack() async => requests.length > 1;

  @override
  Future<void> goBack() async {
    requests.removeLast();
    callbacks.onFinished(requests.last.toString());
  }
}

void main() {
  final base = Uri.parse('http://127.0.0.1:3000/');
  Uri site(String path) {
    final uri = base.resolve(path);
    return uri.replace(
      queryParameters: {...uri.queryParameters, 'mobile': '1'},
    );
  }

  testWidgets(
    'Tabs open live website routes and login keeps Account selected',
    (tester) async {
      final browser = FakeWebsiteBrowser();
      await tester.pumpWidget(VulithubaApp(browser: browser, baseUrl: base));
      await tester.pumpAndSettle();
      expect(browser.requests.last, site('mobile.html'));

      for (final tab in {
        'Services': 'services',
        'Plans': 'plans',
        'Support': 'contact',
      }.entries) {
        await tester.tap(find.widgetWithText(NavigationDestination, tab.key));
        await tester.pumpAndSettle();
        expect(browser.requests.last, site('index.html#${tab.value}'));
      }
      await tester.tap(find.widgetWithText(NavigationDestination, 'Account'));
      await tester.pumpAndSettle();
      expect(browser.requests.last, site('account.html'));
      browser.callbacks.onFinished(base.resolve('login.html').toString());
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        4,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Section jumps finish loading without a page-finished event', (
    tester,
  ) async {
    final browser = FakeWebsiteBrowser();
    await tester.pumpWidget(VulithubaApp(browser: browser, baseUrl: base));
    await tester.pumpAndSettle();
    browser.callbacks.onUrlChanged('about:blank');
    await tester.tap(find.widgetWithText(NavigationDestination, 'Services'));
    await tester.pumpAndSettle();
    browser.hashOnly = true;
    await tester.tap(find.widgetWithText(NavigationDestination, 'Plans'));
    await tester.pumpAndSettle();
    expect(find.byType(LinearProgressIndicator), findsNothing);
    await tester.pump(const Duration(seconds: 31));
    expect(find.text('Unable to load Vulithuba'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Menu opens coverage and account without customer admin links', (
    tester,
  ) async {
    final browser = FakeWebsiteBrowser();
    await tester.pumpWidget(VulithubaApp(browser: browser, baseUrl: base));
    await tester.pumpAndSettle();
    for (final entry in {
      'Coverage': 'index.html#coverage',
      'My account': 'account.html',
      'About Vulithuba': 'index.html#home',
    }.entries) {
      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      expect(find.text('Leads dashboard'), findsNothing);
      expect(find.text('Log in'), findsNothing);
      await tester.scrollUntilVisible(
        find.text(entry.key),
        160,
        scrollable: find
            .descendant(
              of: find.byType(Drawer),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.tap(find.text(entry.key));
      await tester.pumpAndSettle();
      expect(browser.requests.last, site(entry.value));
    }
  });

  testWidgets('A failed page can recover without losing the selected route', (
    tester,
  ) async {
    final browser = FakeWebsiteBrowser()..fail = true;
    await tester.pumpWidget(VulithubaApp(browser: browser, baseUrl: base));
    await tester.pumpAndSettle();
    expect(find.text('Unable to load Vulithuba'), findsOneWidget);
    browser.fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Unable to load Vulithuba'), findsNothing);
    expect(browser.requests.length, 2);
    expect(browser.requests.first, browser.requests.last);
  });

  testWidgets('Website confirmation dialogs let the user cancel', (
    tester,
  ) async {
    final browser = FakeWebsiteBrowser();
    await tester.pumpWidget(VulithubaApp(browser: browser, baseUrl: base));
    await tester.pumpAndSettle();
    final confirmation = browser.callbacks.onConfirm(
      'Delete your account permanently?',
    );
    await tester.pumpAndSettle();
    expect(find.text('Delete your account permanently?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(await confirmation, isFalse);
  });
}
