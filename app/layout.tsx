import './globals.css'

export const metadata = {
  title: 'ChartSignal — Live Trading Chart',
  description: 'Real-time trading chart with EMA/ATR indicators and signal alerts',
  icons: { icon: '/favicon.svg' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ChartSignal',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f0f0f',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#0f0f0f" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="dark overscroll-none">{children}</body>
    </html>
  )
}
