/**
 * The enquiry page is a client component throughout — it reads the course
 * from the query string and runs the code-then-send flow in the browser — so
 * its messages are handed over here, from the server, for that page alone.
 */

import { ClientMessages } from "@/i18n/ClientMessages";
import { ENQUIRY_CLIENT_NAMESPACES } from "@/i18n/namespaces";

export default function EnquiryLayout({ children }: { children: React.ReactNode }) {
  return <ClientMessages namespaces={ENQUIRY_CLIENT_NAMESPACES}>{children}</ClientMessages>;
}
