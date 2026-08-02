import React, { useState } from 'react';

/**
 * CompetitorMailViewer Component
 * 
 * Safely renders raw competitor email payloads in an isolated sandbox iframe
 * to prevent script execution, site cookie access, or CSS/styling pollution.
 * Includes interactive details metadata header panel.
 */
export default function CompetitorMailViewer({ mailer }) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (!mailer || !mailer.extracted_html_body) {
    return (
      <div style={styles.emptyContainer}>
        <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M22 6l-10 7L2 6" />
        </svg>
        <p style={styles.emptyText}>No competitor email selected or payload body missing</p>
      </div>
    );
  }

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

  const containerStyle = isFullscreen 
    ? { ...styles.viewerCard, ...styles.fullscreenContainer } 
    : styles.viewerCard;

  return (
    <div style={containerStyle}>
      {/* Header Panel metadata details */}
      <div style={styles.headerPanel}>
        <div style={styles.metaInfo}>
          <span style={styles.senderBadge}>
            {mailer.competitor_sender || 'Unknown Sender'}
          </span>
          <h3 style={styles.emailSubject}>
            {mailer.email_subject || '(No Subject)'}
          </h3>
          {mailer.received_at && (
            <p style={styles.timestamp}>
              Captured: {new Date(mailer.received_at).toLocaleString()}
            </p>
          )}
        </div>
        
        <div style={styles.actionsGroup}>
          {mailer.s3_snapshot_url && (
            <a 
              href={mailer.s3_snapshot_url} 
              target="_blank" 
              rel="noopener noreferrer" 
              style={styles.snapshotButton}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              View Image Archive
            </a>
          )}
          
          <button onClick={toggleFullscreen} style={styles.fullscreenButton}>
            {isFullscreen ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
                </svg>
                Exit Focus
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
                Focus Frame
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Isolated Rendering IFrame Block */}
      <div style={styles.iframeWrapper}>
        <iframe
          title={`Competitor Email ${mailer.id || 'Preview'}`}
          srcDoc={mailer.extracted_html_body}
          // Strict Sandboxing:
          // - 'allow-same-origin' resolves relative path image dependencies safely.
          // - omitting 'allow-scripts' blocks JS execution inside the iframe context.
          // - omitting 'allow-popups' prevents redirection clicks from stealing focus.
          sandbox="allow-same-origin"
          style={styles.sandboxIframe}
          loading="lazy"
        />
      </div>
    </div>
  );
}

// Inline component-level CSS definitions using Brand-aligned styling (#6A33D8 deep purple, lava, chalk)
const styles = {
  viewerCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)',
    border: '1px solid #EAEAEA',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  fullscreenContainer: {
    position: 'fixed',
    top: '20px',
    left: '20px',
    right: '20px',
    bottom: '20px',
    zIndex: 9999,
    height: 'calc(100vh - 40px)',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2)',
  },
  headerPanel: {
    padding: '16px 20px',
    backgroundColor: '#F7F5F2', // Premium Brand Chalk
    borderBottom: '1px solid #EAE5D9',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
  },
  metaInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: '1 1 300px',
  },
  senderBadge: {
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: '#6A33D8', // Brand Deep Purple
    backgroundColor: 'rgba(0, 74, 43, 0.08)',
    padding: '4px 8px',
    borderRadius: '4px',
    alignSelf: 'flex-start',
  },
  emailSubject: {
    margin: '4px 0 0 0',
    fontSize: '16px',
    fontWeight: '700',
    color: '#111111',
    fontFamily: "'Montserrat', 'Raleway', Georgia, serif",
  },
  timestamp: {
    margin: 0,
    fontSize: '12px',
    color: '#666666',
    fontFamily: "'Instrument Sans', 'Helvetica Neue', Arial, sans-serif",
  },
  actionsGroup: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  snapshotButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: '600',
    textDecoration: 'none',
    color: '#444444',
    backgroundColor: '#FFFFFF',
    border: '1px solid #D6D6D6',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  fullscreenButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#FFFFFF',
    backgroundColor: '#6A33D8', // Brand Deep Purple
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  iframeWrapper: {
    width: '100%',
    flex: 1,
    minHeight: '450px',
    position: 'relative',
    backgroundColor: '#F9F9F9',
  },
  sandboxIframe: {
    width: '100%',
    height: '100%',
    minHeight: '500px',
    border: 'none',
    display: 'block',
    backgroundColor: '#FFFFFF',
  },
  emptyContainer: {
    padding: '60px 20px',
    textAlign: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    border: '2px dashed #EAEAEA',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
  },
  emptyIcon: {
    width: '48px',
    height: '48px',
    color: '#CCCCCC',
  },
  emptyText: {
    margin: 0,
    fontSize: '14px',
    color: '#888888',
    fontFamily: "'Instrument Sans', 'Helvetica Neue', Arial, sans-serif",
  }
};
