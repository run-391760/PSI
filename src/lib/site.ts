/** Public site details shown on the About, Privacy Policy and Contact pages and in the footer. */
export const SITE = {
  product: "SynapseSEO + CX",
  operator: "Parul University",
  team: "Online Reputation Management (ORM) team",
  email: process.env.CONTACT_EMAIL || "orm@paruluniversity.ac.in",
  address: ["Parul University", "P.O. Limda, Ta. Waghodia", "Vadodara, Gujarat 391760", "India"],
  website: "https://paruluniversity.ac.in",
  policyUpdated: "20 November 2026",
} as const;

export const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/contact", label: "Contact Us" },
] as const;
