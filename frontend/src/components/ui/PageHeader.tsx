import type { ReactNode } from "react";

type PageHeaderProps = {
  breadcrumb?: string[];
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ breadcrumb = [], title, description, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header-copy">
        {breadcrumb.length ? (
          <nav className="ui-breadcrumb" aria-label="Breadcrumb">
            <ol>
              {breadcrumb.map((item, index) => (
                <li key={`${item}-${index}`} aria-current={index === breadcrumb.length - 1 ? "page" : undefined}>
                  <span className={index === breadcrumb.length - 1 ? "current" : ""}>{item}</span>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </header>
  );
}
