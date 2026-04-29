import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Link, Preview, Heading, Button,
} from '@react-email/components';

export interface PostStatusChangedProps {
  name?:        string;
  platform:     string;
  post_type:    string;
  action:       'activated' | 'deactivated';
  reason:       string;
  caption?:     string;
  permalink?:   string;      // URL on the social platform (e.g. instagram.com/...)
  scheduled_at?: string;
  published_at?: string;
  created_at:   string;
  postUrl:      string;      // Vielinks post detail URL (/posts/:id)
}

export function PostStatusChanged({
  name, platform, post_type, action, reason, caption,
  permalink, scheduled_at, published_at, created_at, postUrl,
}: PostStatusChangedProps) {
  const platformLabel  = platform.charAt(0).toUpperCase() + platform.slice(1);
  const typeLabel      = post_type.charAt(0).toUpperCase() + post_type.slice(1);
  const isDeactivated  = action === 'deactivated';
  const captionPreview = caption ? (caption.length > 160 ? caption.slice(0, 160) + '…' : caption) : null;

  const dateLabel = published_at
    ? `Published ${new Date(published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
    : scheduled_at
      ? `Scheduled for ${new Date(scheduled_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
      : `Created ${new Date(created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;

  return (
    <Html lang="en">
      <Head />
      <Preview>
        Your {platformLabel} post has been {action} by a Vielink administrator
      </Preview>
      <Body style={body}>
        <Container style={container}>

          {/* Logo */}
          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          {/* Main content */}
          <Section style={contentSection}>

            {/* Status indicator strip */}
            <div style={{
              background: isDeactivated ? '#fef2f2' : '#f0fdf4',
              borderLeft: `4px solid ${isDeactivated ? '#dc2626' : '#16a34a'}`,
              padding: '12px 16px',
              borderRadius: '0 8px 8px 0',
              marginBottom: '24px',
            }}>
              <Text style={{ ...text, margin: 0, fontWeight: 600, color: isDeactivated ? '#dc2626' : '#16a34a' }}>
                Post {isDeactivated ? 'Deactivated' : 'Reactivated'}
              </Text>
            </div>

            <Heading style={heading}>
              Hi {name ?? 'there'},
            </Heading>

            <Text style={text}>
              Your <strong>{platformLabel}</strong> {typeLabel.toLowerCase()} has been{' '}
              <strong>{action}</strong> by a platform administrator.
            </Text>

            {/* Reason */}
            <Section style={reasonBox}>
              <Text style={{ ...smallLabel, marginBottom: '4px' }}>Reason</Text>
              <Text style={{ ...text, margin: 0, fontStyle: 'italic', color: '#374151' }}>
                &ldquo;{reason}&rdquo;
              </Text>
            </Section>

            <Hr style={hrThin} />

            {/* Post details */}
            <Text style={sectionTitle}>Post details</Text>

            <Text style={detailRow}>
              <span style={detailKey}>Platform</span>
              <span style={detailVal}>{platformLabel}</span>
            </Text>
            <Text style={detailRow}>
              <span style={detailKey}>Type</span>
              <span style={detailVal}>{typeLabel}</span>
            </Text>
            <Text style={detailRow}>
              <span style={detailKey}>Status</span>
              <span style={{ ...detailVal, fontWeight: 600, color: isDeactivated ? '#dc2626' : '#16a34a' }}>
                {isDeactivated ? 'Inactive' : 'Draft (restored)'}
              </span>
            </Text>
            <Text style={detailRow}>
              <span style={detailKey}>Date</span>
              <span style={detailVal}>{dateLabel}</span>
            </Text>

            {captionPreview && (
              <Text style={detailRow}>
                <span style={detailKey}>Caption</span>
                <span style={{ ...detailVal, color: '#6b7280' }}>{captionPreview}</span>
              </Text>
            )}

            {permalink && (
              <Text style={detailRow}>
                <span style={detailKey}>Post URL</span>
                <Link href={permalink} style={link}>{platform} post &rarr;</Link>
              </Text>
            )}

            <Hr style={hrThin} />

            {/* CTA */}
            {isDeactivated ? (
              <>
                <Text style={text}>
                  Your post is no longer visible on the platform. If you believe this was a mistake or would like to appeal, please{' '}
                  <Link href="mailto:support@vielink.app" style={link}>contact support</Link>.
                </Text>
                <Button href={postUrl} style={btnSecondary}>
                  View post in Vielinks
                </Button>
              </>
            ) : (
              <>
                <Text style={text}>
                  Your post has been restored as a <strong>draft</strong>. You can review it and republish when ready.
                </Text>
                <Button href={postUrl} style={btnPrimary}>
                  View & republish in Vielinks
                </Button>
              </>
            )}
          </Section>

          <Hr style={hr} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footer}>
              Questions? Reach out to{' '}
              <Link href="mailto:support@vielink.app" style={footerLink}>Vielink Support</Link>.
            </Text>
            <Text style={footer}>
              &copy; {new Date().getFullYear()} Vielink. All rights reserved.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const body: React.CSSProperties        = { backgroundColor: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', margin: '0 auto', padding: '0 8px' };
const container: React.CSSProperties   = { maxWidth: '520px', margin: '40px auto', padding: '32px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e5e7eb' };
const logoSection: React.CSSProperties = { marginBottom: '24px' };
const logo: React.CSSProperties        = { color: '#111827', fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.5px' };
const hr: React.CSSProperties          = { borderColor: '#e5e7eb', margin: '0' };
const hrThin: React.CSSProperties      = { borderColor: '#f3f4f6', margin: '20px 0' };
const contentSection: React.CSSProperties = { padding: '28px 0' };
const heading: React.CSSProperties     = { color: '#111827', fontSize: '22px', fontWeight: 600, margin: '0 0 12px', padding: 0 };
const text: React.CSSProperties        = { color: '#374151', fontSize: '14px', lineHeight: '24px', margin: '0 0 12px' };
const sectionTitle: React.CSSProperties = { color: '#6b7280', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 10px' };
const detailRow: React.CSSProperties   = { fontSize: '14px', lineHeight: '22px', margin: '0 0 6px', color: '#374151' };
const detailKey: React.CSSProperties   = { color: '#9ca3af', display: 'inline-block', width: '80px', fontSize: '13px' };
const detailVal: React.CSSProperties   = { color: '#111827', fontSize: '14px' };
const smallLabel: React.CSSProperties  = { color: '#6b7280', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 };
const reasonBox: React.CSSProperties   = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px', margin: '16px 0 20px' };
const link: React.CSSProperties        = { color: '#2563eb', textDecoration: 'underline', fontSize: '14px' };
const btnPrimary: React.CSSProperties  = { backgroundColor: '#111827', color: '#ffffff', fontSize: '14px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block', margin: '8px 0' };
const btnSecondary: React.CSSProperties = { backgroundColor: '#f3f4f6', color: '#111827', fontSize: '14px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block', margin: '8px 0' };
const footerSection: React.CSSProperties = { paddingTop: '20px' };
const footer: React.CSSProperties      = { color: '#9ca3af', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
const footerLink: React.CSSProperties  = { color: '#9ca3af', textDecoration: 'underline' };
