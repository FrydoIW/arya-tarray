"use client";

import { ShieldX } from "lucide-react";

export function AccessDenied() {
  return (
    <section className="ui-access-denied" role="alert">
      <span className="ui-access-denied-icon" aria-hidden="true">
        <ShieldX size={24} />
      </span>
      <div>
        <h1>Access denied</h1>
        <p>Your assigned role does not have access to this menu.</p>
      </div>
    </section>
  );
}
