/** @format */

import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import AuthProvider from '@/components/AuthProvider';
import QueryProvider from '@/components/QueryProvider';
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
    <html lang="en" style={{ height: '100dvh', overflow: 'hidden' }}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased h-dvh overflow-hidden`}>
        <QueryProvider>
          <NotificationsProvider>
            <Notifications />
            <AuthProvider>{children}</AuthProvider>
          </NotificationsProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
