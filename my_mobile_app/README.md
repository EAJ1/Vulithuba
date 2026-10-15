# Vulithuba Mobile

The Android/iPhone app displays the live Vulithuba website in a system WebView.
It includes the existing website design, services, coverage, plans, contact
form, signup and verification, login and password recovery, account editing,
password changes, account deletion, billing, and leads/payment dashboard.
Backend authentication and permissions continue to apply. Website session
cookies stay in the WebView; database credentials remain on the server.

The app adds a mobile menu, Home/Services/Plans/Support/Account tabs, browser
history, refresh, loading progress, connection recovery, confirmation dialogs,
and phone/email link handling. Home is a dedicated customer dashboard: visitors
see login/signup and discovery actions; signed-in customers see their real plan,
billing status, and payment method. Account data is fetched through the WebView's
session, without copying credentials into Dart.

Embedded marketing pages hide their website header/footer so the app has one
navigation system. All internal links preserve `mobile=1` and any plan query.
The customer menu has one account entry; login/signup/recovery are available in
the account flow. Staff access is shown on Home only after `/api/me` returns
`isAdmin: true`. The backend protects leads, payments, and the staff page with
administrator checks.

## Run locally

Start the existing backend from the parent folder:

```bash
./start-vulithuba.command
```

From this mobile project folder:

```bash
export PATH="$(cd ../.tools/flutter/bin && pwd):$PATH"
flutter run
```

The iPhone simulator connects to `http://127.0.0.1:3000`. Android emulators
connect to the Mac through `http://10.0.2.2:3000`. Android's debug configuration
allows HTTP only for these local development hosts. Android release builds
should use your deployed HTTPS website.

A physical phone needs a reachable website, rather than the simulator's local
address. Run with your deployed website URL:

```bash
flutter run --dart-define=VULITHUBA_URL=https://your-vulithuba-domain.example
```

The website and `/api/*` must be served together from that origin. The server
must stay running; the app does not bundle the Node.js server or database.
PayFast, email/SMS verification, and password-reset delivery depend on the
existing server configuration. PayFast was not configured in the local health
check; the website disables checkout until it is configured.

Open this folder in IntelliJ IDEA with the Flutter and Dart plugins. The local
Flutter SDK is `/Users/africajarana/Downloads/Vithum/.tools/flutter`.
The project-local Android SDK is `../.tools/android-sdk`. Xcode and iOS simulators are installed.
The iOS plugins use Flutter's Swift Package Manager integration.

## Validation

```bash
flutter analyze
flutter test
flutter test integration_test/website_test.dart -d <simulator-id>
```

The integration test needs the backend running. It checks live website content,
plan selection into signup, contact-form availability, unauthenticated account
login form, an invalid login request, and recovery from an unavailable page. It
does not create accounts, send contact notifications, or initiate payments.

## Install on an Android phone

The application ID is `za.co.vulithuba.app`, and the launcher icon uses the Vulithuba V logo.
For local testing, keep the phone and Mac on the same Wi-Fi and the backend running.
The debug network policy allows this Mac's address, `192.168.0.3`, in addition to emulator hosts.

Build a debug APK from this directory (using the SDK installed for this project):

```bash
ANDROID_HOME="$PWD/../.tools/android-sdk" \
JAVA_HOME="$PWD/../.tools/jdk21/Contents/Home" \
../.tools/flutter/bin/flutter build apk --debug --dart-define=VULITHUBA_URL=http://192.168.0.3:3000
```

The APK is `build/app/outputs/flutter-apk/app-debug.apk`.
Copy it to the Android phone, open it, and allow installation from that source when prompted.
Alternatively, enable USB debugging, connect by USB, approve the Mac on the phone, and run:

```bash
../.tools/android-sdk/platform-tools/adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

This APK is for local development. A release build needs the hosted HTTPS address and a dedicated release signing key; the current release signing configuration uses a development key.

## Matching iPhone app

Both platforms use this Flutter project and the same Material theme, screens, tabs and menu. The iPhone launcher icon matches Android. The iPhone bundle ID is `Vulithuba.Vulithuba` and its development team matches the original native app, allowing installation as an update. The old `../Vulithuba` SwiftUI project is a legacy prototype and has a different interface.

Build the standalone iPhone app with:

```bash
../.tools/flutter/bin/flutter build ios --release --build-number=3 --dart-define=VULITHUBA_URL=http://192.168.0.3:3000
```

Use `ios/Runner.xcworkspace` for Xcode development. A physical phone needs the LAN address or your hosted HTTPS website; the default loopback URL is intended for simulators.
