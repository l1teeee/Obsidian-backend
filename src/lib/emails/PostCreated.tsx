import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Link, Preview, Heading,
} from '@react-email/components';

interface PostCreatedProps {
  name?:        string;
  platform:     string;
  status:       string;
  caption?:     string;
  scheduledAt?: string;
  dashboardUrl: string;
}

export function PostCreated({ name, platform, status, caption, scheduledAt, dashboardUrl }: PostCreatedProps) {
  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
  const statusLabel   = status === 'published' ? 'Published' : status === 'scheduled' ? 'Scheduled' : 'Saved as draft';
  const captionPreview = caption ? (caption.length > 100 ? caption.slice(0, 100) + '...' : caption) : null;

  return (
    <Html lang="en">
      <Head />
      <Preview>Your {platformLabel} post has been {statusLabel.toLowerCase()}</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>
            <Heading style={heading}>Post {statusLabel.toLowerCase()}</Heading>
            <Text style={text}>
              Hi {name ?? 'there'}, your post on <strong>{platformLabel}</strong> has been {statusLabel.toLowerCase()}.
            </Text>

            <Text style={detailRow}>
              <span style={detailKey}>Platform</span>
              <span style={detailVal}>{platformLabel}</span>
            </Text>
            <Text style={detailRow}>
              <span style={detailKey}>Status</span>
              <span style={detailVal}>{statusLabel}</span>
            </Text>
            {scheduledAt && (
              <Text style={detailRow}>
                <span style={detailKey}>Scheduled</span>
                <span style={detailVal}>{scheduledAt}</span>
              </Text>
            )}
            {captionPreview && (
              <Text style={detailRow}>
                <span style={detailKey}>Caption</span>
                <span style={detailVal}>{captionPreview}</span>
              </Text>
            )}

            <Hr style={hrThin} />

            <Text style={text}>
              <Link href={dashboardUrl} style={link}>View your posts</Link> in the dashboard.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footerSection}>
            <Text style={footer}>
              If you&apos;d like to report an issue, reach out to{' '}
              <Link href="mailto:support@vielink.app" style={footerLink}>Vielink Support</Link>.
            </Text>
            <Text style={footer}>
              Copyright &copy; {new Date().getFullYear()} Vielink. All rights reserved.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', margin: '0 auto', padding: '0 8px' };
const container: React.CSSProperties = { maxWidth: '465px', margin: '40px auto', padding: '20px' };
const logoSection: React.CSSProperties = { marginBottom: '24px' };
const logo: React.CSSProperties = { color: '#000000', fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.5px' };
const hr: React.CSSProperties = { borderColor: '#eaeaea', margin: '0' };
const hrThin: React.CSSProperties = { borderColor: '#eaeaea', margin: '16px 0' };
const contentSection: React.CSSProperties = { padding: '32px 0' };
const heading: React.CSSProperties = { color: '#000000', fontSize: '24px', fontWeight: 400, margin: '0 0 16px', padding: 0 };
const text: React.CSSProperties = { color: '#000000', fontSize: '14px', lineHeight: '24px', margin: '0 0 10px' };
const detailRow: React.CSSProperties = { color: '#000000', fontSize: '14px', lineHeight: '24px', margin: '0 0 4px' };
const detailKey: React.CSSProperties = { color: '#666666', display: 'inline-block', width: '72px', fontSize: '14px' };
const detailVal: React.CSSProperties = { color: '#000000', fontSize: '14px' };
const link: React.CSSProperties = { color: '#000000', textDecoration: 'underline' };
const footerSection: React.CSSProperties = { paddingTop: '20px' };
const footer: React.CSSProperties = { color: '#666666', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
const footerLink: React.CSSProperties = { color: '#666666', textDecoration: 'underline' };
