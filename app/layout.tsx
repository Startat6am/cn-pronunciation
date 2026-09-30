import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata={title:"Китайский на слух — HSK 1",description:"Тренировка произношения китайского языка"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>;}
