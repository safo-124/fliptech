/**
 * Asking a seller about a product. Browser only.
 *
 * The verification half is deliberately the enquiry endpoints the training
 * flow already uses, not a marketplace copy of them: the session trust is
 * shared, so somebody who verified their number to ask about a welding
 * course an hour ago does not type another code to ask about a bag.
 */

import {trainerFetch as sessionFetch} from "./trainer-api";

export {TrainerApiError as MarketplaceApiError} from "./trainer-api";

/** Send a code to a number that has not proved itself in this session. */
export function requestBuyerCode(phone: string) {
  return sessionFetch<{verified: boolean; code_sent: boolean; expires_in_seconds?: number}>(
    "/api/enquiries/request-code/",
    {method: "POST", body: JSON.stringify({phone})},
  );
}

export function verifyBuyerCode(phone: string, code: string) {
  return sessionFetch<{verified: boolean; signed_in: boolean}>("/api/enquiries/verify-code/", {
    method: "POST",
    body: JSON.stringify({phone, code}),
  });
}

export type AskResult = {reference_code: string; detail: string};

export function askAboutProduct(
  productId: number,
  body: {phone: string; name?: string; message?: string},
) {
  return sessionFetch<AskResult>(`/api/products/${productId}/enquiries/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
