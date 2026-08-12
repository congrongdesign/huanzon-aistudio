import type { Metadata } from 'next';
import Script from 'next/script';
import { Inspector } from 'react-dev-inspector';
import './globals.css';
import './dark-theme-v2.css';

export const metadata: Metadata = {
  title: '环中AIStudio | AI 设计画布',
  description: '在画布上与AI对话，共创设计',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" className="dark" data-theme-engine="v2" suppressHydrationWarning>
      <body className={`antialiased`}>
        <Script id="ui-scale" strategy="beforeInteractive">
          {`try {
            // Desktop shell (Electron) handles scaling natively via zoom factor,
            // so only adapt the plain-browser preview here. No top-level "return"
            // allowed in this inline script (it breaks the dev-inspector transform).
            var isDesktopShell = window.electronAPI && window.electronAPI.isDesktop;
            if (!isDesktopShell) {
              var uiDesignW = 1440;
              var uiDesignH = 900;
              function applyUiScale() {
                var w = window.innerWidth;
                var h = window.innerHeight;
                if (w && h) {
                  var s = Math.min(w / uiDesignW, h / uiDesignH);
                  // Only scale UP on large screens (fixes "text too small"); never
                  // shrink below the design size (avoids "too big" / tiny fonts).
                  s = Math.max(1, Math.min(1.15, s));
                  document.documentElement.style.fontSize = (16 * s).toFixed(3) + 'px';
                  document.documentElement.style.setProperty('--ui-scale', s.toFixed(3));
                }
              }
              applyUiScale();
              var uiScaleTimer = null;
              window.addEventListener('resize', function () {
                if (uiScaleTimer) clearTimeout(uiScaleTimer);
                uiScaleTimer = setTimeout(applyUiScale, 120);
              });
            }
          } catch (e) {}`}
        </Script>
        <Script id="theme-init" strategy="beforeInteractive">
          {`try {
            const legacyTheme = localStorage.getItem('theme');
            const hzTheme = localStorage.getItem('hz_theme');
            const theme = hzTheme || legacyTheme;
            const root = document.documentElement;
            if (theme === 'light') root.classList.remove('dark');
            else root.classList.add('dark');
            root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
            if (theme) {
              localStorage.setItem('hz_theme', theme);
              localStorage.setItem('theme', theme);
            }
            if (theme === 'light') {
              root.setAttribute('data-theme-engine', 'v1');
            } else {
              root.setAttribute('data-theme-engine', 'v2');
            }
            root.setAttribute('data-theme-ready', '1');
          } catch (e) {}`}
        </Script>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
