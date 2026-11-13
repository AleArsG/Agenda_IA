import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agenda IA",
  description: "Agenda inteligente y planificador de estudio con asistente de IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
