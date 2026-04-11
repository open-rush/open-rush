export const metadata = {
  title: 'Rush',
  description: 'Enterprise AI Agent Infrastructure',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
