"use client";

/**
 * The signed-in person's name and number, for forms that ask for them.
 *
 * One login covers the whole site, so a form should not ask somebody who is
 * signed in to type their name and number again, or text them a code to
 * prove a number they proved at sign-in. The enquiry and quote forms start
 * from these. A different number typed instead still gets a code: the
 * server only skips it for a number the session already vouches for.
 */

import {useEffect, useState} from "react";

import {getAccount} from "./account-api";

export type AccountContact = {
  /** As a person types it: 024 123 4567. */
  phone: string;
  /** +233241234567, to compare with what is in the form. */
  e164: string;
  name: string;
};

/** +233241234567 as 0241234567, the way it is written in Ghana. */
export function localPhone(e164: string) {
  return e164.startsWith("+233") ? `0${e164.slice(4)}` : e164;
}

/** Null while loading and for a visitor who is not signed in. */
export function useAccountContact(): AccountContact | null {
  const [contact, setContact] = useState<AccountContact | null>(null);
  useEffect(() => {
    let active = true;
    getAccount()
      .then((session) => {
        if (!active || !session.authenticated) return;
        const {phone, display_name} = session.account;
        // A bare number saved as the name is no name to pre-fill.
        const name = /^\+?\d[\d\s]+$/.test(display_name.trim()) ? "" : display_name.trim();
        setContact({phone: localPhone(phone), e164: phone, name});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return contact;
}
