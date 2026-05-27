import './globals.css'
export const metadata = {
  title: 'Deriv Chart',
  description: 'Live trading chart with EMA/ATR indicators',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="dark">{children}</body>
    </html>
  )
}
