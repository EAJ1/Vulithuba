import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'website_browser.dart';

void main() => runApp(const VulithubaApp());

Uri websiteBaseUrl() {
  const configured = String.fromEnvironment('VULITHUBA_URL');
  final fallback = defaultTargetPlatform == TargetPlatform.android
      ? 'http://10.0.2.2:3000'
      : 'http://127.0.0.1:3000';
  final url = Uri.parse(configured.isEmpty ? fallback : configured);
  if (!['http', 'https'].contains(url.scheme) || url.host.isEmpty) {
    throw ArgumentError(
      'VULITHUBA_URL must be a full HTTP or HTTPS website URL.',
    );
  }
  return url.resolve('/');
}

class VulithubaApp extends StatelessWidget {
  const VulithubaApp({super.key, this.browser, this.baseUrl});

  final WebsiteBrowser? browser;
  final Uri? baseUrl;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Vulithuba',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      // Keep the app shell's typography and alignment identical on both phones.
      platform: TargetPlatform.android,
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff0f4c81)),
      scaffoldBackgroundColor: const Color(0xfff4f8ff),
      useMaterial3: true,
    ),
    home: DashboardScreen(browser: browser, baseUrl: baseUrl),
  );
}

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, this.browser, this.baseUrl});

  final WebsiteBrowser? browser;
  final Uri? baseUrl;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late final WebsiteBrowser _browser;
  late final Uri _baseUrl;
  late Uri _currentUrl;
  Uri? _lastFinishedUrl;
  Timer? _loadTimer;
  int _selectedIndex = 0;
  int _progress = 0;
  bool _loading = true;
  bool _canGoBack = false;
  String? _error;

  static const _tabPaths = [
    'mobile.html',
    'index.html#services',
    'index.html#plans',
    'index.html#contact',
    'account.html',
  ];

  @override
  void initState() {
    super.initState();
    _baseUrl = widget.baseUrl ?? websiteBaseUrl();
    _currentUrl = _siteUri(_tabPaths.first);
    _browser = widget.browser ?? WebViewWebsiteBrowser();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      await _browser.initialize(
        BrowserCallbacks(
          onStarted: _onStarted,
          onFinished: _onFinished,
          onProgress: (value) {
            if (mounted) setState(() => _progress = value);
          },
          onError: _onError,
          onUrlChanged: _onUrlChanged,
          onConfirm: _confirm,
          onAlert: _alert,
        ),
      );
      if (mounted) await _load(_currentUrl);
    } catch (_) {
      _onError('Unable to open the website on this device.');
    }
  }

  void _onStarted(String url) {
    if (!mounted) return;
    _loadTimer?.cancel();
    _loadTimer = Timer(const Duration(seconds: 30), () {
      _onError('The connection is taking too long. Please try again.');
    });
    setState(() {
      _currentUrl = Uri.parse(url);
      _loading = true;
      _progress = 0;
      _error = null;
    });
  }

  void _onFinished(String url) {
    if (!mounted) return;
    _loadTimer?.cancel();
    _lastFinishedUrl = Uri.tryParse(url)?.replace(fragment: '');
    setState(() => _loading = false);
    _onUrlChanged(url);
  }

  void _onUrlChanged(String url) {
    if (!mounted) return;
    final uri = Uri.tryParse(url);
    if (uri == null || !['http', 'https'].contains(uri.scheme)) return;
    if (uri.replace(fragment: '') == _lastFinishedUrl) {
      _loadTimer?.cancel();
      _loading = false;
    }
    setState(() {
      _currentUrl = uri;
      if (uri.origin == _baseUrl.origin) {
        if ([
          'account.html',
          'login.html',
          'signup.html',
          'forgot-password.html',
          'reset-password.html',
          'verify-account.html',
          'admin.html',
        ].contains(uri.path.split('/').last)) {
          _selectedIndex = 4;
        } else {
          _selectedIndex = switch (uri.fragment) {
            'services' => 1,
            'plans' => 2,
            'contact' => 3,
            _ => 0,
          };
        }
      }
    });
    unawaited(_updateHistory());
  }

  Future<void> _updateHistory() async {
    final canGoBack = await _browser.canGoBack();
    if (mounted) setState(() => _canGoBack = canGoBack);
  }

  void _onError(String message) {
    if (!mounted) return;
    _loadTimer?.cancel();
    setState(() {
      _loading = false;
      _error = message;
    });
  }

  Future<void> _load(Uri uri) async {
    _onStarted(uri.toString());
    try {
      await _browser.load(uri);
    } catch (_) {
      _onError('Unable to connect to Vulithuba.');
    }
  }

  Uri _siteUri(String path) {
    final uri = _baseUrl.resolve(path);
    return uri.replace(
      queryParameters: {...uri.queryParameters, 'mobile': '1'},
    );
  }

  void _open(String path) => unawaited(_load(_siteUri(path)));

  Future<bool> _confirm(String message) async {
    if (!mounted) return false;
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Vulithuba'),
            content: Text(message),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Confirm'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _alert(String message) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Vulithuba'),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Widget _drawerLink(String label, IconData icon, String path) => ListTile(
    leading: Icon(icon),
    title: Text(label),
    onTap: () {
      Navigator.pop(context);
      _open(path);
    },
  );

  @override
  void dispose() {
    _loadTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_canGoBack,
    onPopInvokedWithResult: (didPop, result) {
      if (!didPop) unawaited(_browser.goBack());
    },
    child: Scaffold(
      appBar: AppBar(
        title: const Text('Vulithuba'),
        backgroundColor: const Color(0xff0f4c81),
        foregroundColor: Colors.white,
        actions: [
          if (_canGoBack)
            IconButton(
              tooltip: 'Back',
              icon: const Icon(Icons.arrow_back),
              onPressed: () => unawaited(_browser.goBack()),
            ),
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: () => unawaited(_load(_currentUrl)),
          ),
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: ListView(
            children: [
              const ListTile(
                leading: CircleAvatar(child: Text('V')),
                title: Text(
                  'Vulithuba',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: Text('Connecting South Africa'),
              ),
              const Divider(),
              _drawerLink('Home', Icons.home_outlined, 'mobile.html'),
              _drawerLink('Services', Icons.apps, 'index.html#services'),
              _drawerLink('Coverage', Icons.public, 'index.html#coverage'),
              _drawerLink('Plans', Icons.wifi, 'index.html#plans'),
              _drawerLink('Support', Icons.support_agent, 'index.html#contact'),
              const Divider(),
              _drawerLink('My account', Icons.person_outline, 'account.html'),
              _drawerLink(
                'About Vulithuba',
                Icons.info_outline,
                'index.html#home',
              ),
            ],
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_loading) LinearProgressIndicator(value: _progress / 100),
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(child: _browser.view),
                  if (_error != null)
                    Positioned.fill(
                      child: ColoredBox(
                        color: Theme.of(context).scaffoldBackgroundColor,
                        child: Center(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.cloud_off_outlined, size: 56),
                                const SizedBox(height: 16),
                                const Text(
                                  'Unable to load Vulithuba',
                                  style: TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Text(_error!, textAlign: TextAlign.center),
                                const SizedBox(height: 8),
                                const Text(
                                  'Check your connection and try again.',
                                  textAlign: TextAlign.center,
                                ),
                                const SizedBox(height: 24),
                                FilledButton.icon(
                                  onPressed: () =>
                                      unawaited(_load(_currentUrl)),
                                  icon: const Icon(Icons.refresh),
                                  label: const Text('Try again'),
                                ),
                                TextButton(
                                  onPressed: () => _open(_tabPaths.first),
                                  child: const Text('Go to home'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) {
          setState(() => _selectedIndex = index);
          _open(_tabPaths[index]);
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.apps), label: 'Services'),
          NavigationDestination(icon: Icon(Icons.wifi), label: 'Plans'),
          NavigationDestination(
            icon: Icon(Icons.support_agent),
            label: 'Support',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            label: 'Account',
          ),
        ],
      ),
    ),
  );
}
