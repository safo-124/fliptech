/**
 * The names on the map: Accra, the other fifteen regional capitals, and
 * towns people steer by. Where each name sits beside its dot ("r" right,
 * "l" left, "t" above, "b" below) was set by eye, so names miss each other,
 * the lake and the coast.
 */
export type MapPlace = {
  name: string;
  lat: number;
  lng: number;
  kind: "capital" | "regional" | "town";
  side: "r" | "l" | "t" | "b";
};

export const PLACES: MapPlace[] = [
  { name: "Accra", lat: 5.603, lng: -0.187, kind: "capital", side: "b" },
  { name: "Kumasi", lat: 6.688, lng: -1.624, kind: "regional", side: "r" },
  { name: "Tamale", lat: 9.404, lng: -0.839, kind: "regional", side: "r" },
  { name: "Takoradi", lat: 4.934, lng: -1.714, kind: "regional", side: "b" },
  { name: "Cape Coast", lat: 5.105, lng: -1.247, kind: "regional", side: "b" },
  { name: "Koforidua", lat: 6.094, lng: -0.259, kind: "regional", side: "t" },
  { name: "Ho", lat: 6.601, lng: 0.47, kind: "regional", side: "r" },
  { name: "Sunyani", lat: 7.339, lng: -2.327, kind: "regional", side: "l" },
  { name: "Bolgatanga", lat: 10.786, lng: -0.851, kind: "regional", side: "r" },
  { name: "Wa", lat: 10.06, lng: -2.501, kind: "regional", side: "r" },
  { name: "Techiman", lat: 7.586, lng: -1.938, kind: "regional", side: "r" },
  { name: "Goaso", lat: 6.803, lng: -2.517, kind: "regional", side: "l" },
  { name: "Sefwi Wiawso", lat: 6.205, lng: -2.486, kind: "regional", side: "l" },
  { name: "Dambai", lat: 8.072, lng: 0.18, kind: "regional", side: "r" },
  { name: "Damongo", lat: 9.083, lng: -1.818, kind: "regional", side: "r" },
  { name: "Nalerigu", lat: 10.527, lng: -0.369, kind: "regional", side: "r" },
  { name: "Tema", lat: 5.669, lng: -0.017, kind: "town", side: "r" },
  { name: "Obuasi", lat: 6.206, lng: -1.668, kind: "town", side: "l" },
  { name: "Tarkwa", lat: 5.3, lng: -1.996, kind: "town", side: "l" },
  { name: "Winneba", lat: 5.351, lng: -0.623, kind: "town", side: "b" },
  { name: "Keta", lat: 5.918, lng: 0.989, kind: "town", side: "b" },
  { name: "Hohoe", lat: 7.152, lng: 0.473, kind: "town", side: "r" },
  { name: "Yendi", lat: 9.442, lng: -0.01, kind: "town", side: "r" },
  { name: "Salaga", lat: 8.551, lng: -0.519, kind: "town", side: "r" },
  { name: "Kintampo", lat: 8.056, lng: -1.731, kind: "town", side: "r" },
  { name: "Bawku", lat: 11.06, lng: -0.242, kind: "town", side: "r" },
  { name: "Navrongo", lat: 10.895, lng: -1.092, kind: "town", side: "l" },
  { name: "Axim", lat: 4.866, lng: -2.241, kind: "town", side: "b" },
  { name: "Nkawkaw", lat: 6.551, lng: -0.766, kind: "town", side: "r" },
  { name: "Yeji", lat: 8.223, lng: -0.656, kind: "town", side: "l" },
  { name: "Akosombo", lat: 6.3, lng: 0.05, kind: "town", side: "r" },
  { name: "Bole", lat: 9.03, lng: -2.48, kind: "town", side: "r" },
  { name: "Wenchi", lat: 7.74, lng: -2.1, kind: "town", side: "l" },
  { name: "Kete Krachi", lat: 7.8, lng: -0.05, kind: "town", side: "r" },
  { name: "Bimbilla", lat: 8.86, lng: 0.06, kind: "town", side: "r" },
  { name: "Kpandu", lat: 6.99, lng: 0.29, kind: "town", side: "r" },
  { name: "Lawra", lat: 10.65, lng: -2.9, kind: "town", side: "r" },
  { name: "Tumu", lat: 10.88, lng: -1.98, kind: "town", side: "r" },
];
