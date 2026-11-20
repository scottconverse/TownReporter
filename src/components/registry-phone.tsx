import { telHref } from "@/lib/news/registry/registry-phone";

/**
 * One phone number, as a `tel:` link when it has digits to dial (F18). The
 * printed text stays exactly what the entry holds; only the href is stripped.
 */
export function PhoneLink({ phone }: { phone: string }) {
  const href = telHref(phone);
  if (!href) return <>{phone}</>;
  return (
    <a className="textlink" href={href}>
      {phone}
    </a>
  );
}

/** The crisis line the Registry always offers, with both numbers tappable (F19). */
export function CrisisLine() {
  return (
    <p className="registry-crisis">
      In a crisis: call or text <a className="textlink" href="tel:988">988</a>. For local help:
      call <a className="textlink" href="tel:211">211</a>.
    </p>
  );
}
