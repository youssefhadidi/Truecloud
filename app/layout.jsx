/** @format */

import { Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import QueryProvider from '@/components/QueryProvider';
import ReduxProvider from '@/components/ReduxProvider';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import Notifications from '@/components/Notifications';
import { ThemeProvider } from '@/components/ThemeProvider';
import { LanguageProvider } from '@/components/LanguageProvider';
import { getServerLang } from '@/lib/i18n/server';

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata = {
  title: 'Truecloud',
  description: 'Self-hosted cloud — private, secure, fast.',
};

export default async function RootLayout({ children }) {
  const lang = await getServerLang();
  return (
    <html
      lang={lang}
      data-theme="dark"
      style={{ height: '100dvh', overflow: 'hidden' }}
      suppressHydrationWarning
    >
      <body className={`${jakarta.variable} ${geistMono.variable} antialiased h-dvh overflow-hidden`}>
        <LanguageProvider initialLang={lang}>
          <ThemeProvider defaultTheme="dark">
            <ReduxProvider>
              <QueryProvider>
                <NotificationsProvider>
                  <Notifications />
                  {children}
                </NotificationsProvider>
              </QueryProvider>
            </ReduxProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
