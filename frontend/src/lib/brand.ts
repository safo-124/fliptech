/**
 * The brand name, in one place.
 *
 * It appears in the header, the footer disclaimer, both trust badges and the
 * verification block — all copy a trainee reads when deciding whether to
 * believe a listing. The ORC name search was still pending when this was built,
 * so correcting the spelling is one environment variable rather than a search
 * across the components.
 */
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Fliptech";
