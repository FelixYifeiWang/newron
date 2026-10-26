"use client";
import dynamic from "next/dynamic";
// The form reads the link's fragment and a saved draft, which exist only in the browser.
const ReportForm = dynamic(
  () => import("@/components/report-form").then((module) => module.ReportForm),
  { ssr: false },
);
export default function ReportPage() {
  return <ReportForm />;
}
