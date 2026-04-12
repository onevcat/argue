const REPO_URL = "https://github.com/onevcat/argue";
const TWITTER_URL = "https://x.com/onevcat";

const VERSION = typeof __ARGUE_VERSION__ !== "undefined" && __ARGUE_VERSION__ ? __ARGUE_VERSION__ : "dev";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-row">
        <a className="site-footer-link" href={REPO_URL} target="_blank" rel="noreferrer">
          github.com/onevcat/argue
        </a>
        <span className="site-footer-sep" aria-hidden="true">
          ·
        </span>
        <span className="site-footer-version mono">v{VERSION}</span>
      </div>
      <div className="site-footer-row">
        <span>
          Built by{" "}
          <a className="site-footer-link" href={TWITTER_URL} target="_blank" rel="noreferrer">
            @onevcat
          </a>{" "}
          with <span className="site-footer-heart">♥</span>
        </span>
      </div>
    </footer>
  );
}
