/** @format */

import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import AuthProvider from '@/components/AuthProvider';
import QueryProvider from '@/components/QueryProvider';
import UpdateChecker from '@/components/UpdateChecker';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import Notifications from '@/components/Notifications';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata = {
  title: 'TrueCloud',
  description: 'Secure file management for TrueNAS',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" style={{ height: '100dvh' }}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased h-dvh`}>
        <QueryProvider>
          <NotificationsProvider>
            <Notifications />
            <AuthProvider>{children}</AuthProvider>
            <UpdateChecker />
          </NotificationsProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
