import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Preview, Heading, Button,
} from '@react-email/components';

export interface AdminInviteProps {
  name?:         string;
  email:         string;
  addedBy?:      string;
  role?:         'admin' | 'superadmin';
  dashboardUrl:  string;
}

const CAPABILITIES = [
  { icon: '📊', label: 'Platform Overview',  desc: 'Real-time stats, charts, and top workspace rankings.' },
  { icon: '👥', label: 'User Management',    desc: 'Search, activate, and deactivate any user account.' },
  { icon: '🗂️', label: 'Workspace Control',  desc: 'Inspect and toggle the status of all workspaces.' },
  { icon: '📝', label: 'Post Moderation',    desc: 'Review, activate, or deactivate posts across all users.' },
  { icon: '🛡️', label: 'Admin Management',   desc: 'Add or remove platform administrators (Superadmin only).' },
];

export function AdminInvite({ name, addedBy, role = 'admin', dashboardUrl }: AdminInviteProps) {
  const roleLabel = role === 'superadmin' ? 'Superadmin' : 'Admin';

  return (
    <Html lang="en">
      <Head />
      <Preview>You are now an administrator on Vielinks</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielinks</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>
            <div style={badge}>
              <Text style={badgeText}>Admin Access Granted — {roleLabel}</Text>
            </div>

            <Heading style={heading}>Hi {name ?? 'there'}, you are now an admin 🎉</Heading>

            <Text style={text}>
              {addedBy
                ? <><strong>{addedBy}</strong> has added you as a <strong>{roleLabel}</strong> on the Vielinks platform. Your access is active immediately.</>
                : <>You have been added as a <strong>{roleLabel}</strong> on the Vielinks platform. Your access is active immediately.</>
              }
            </Text>

            <Text style={text}>You now have access to:</Text>

            <Section style={capabilitiesBox}>
              {CAPABILITIES.map((cap, i) => (
                <div key={cap.label} style={{ ...capRow, borderBottom: i < CAPABILITIES.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                  <Text style={capIcon}>{cap.icon}</Text>
                  <div>
                    <Text style={capLabel}>{cap.label}</Text>
                    <Text style={capDesc}>{cap.desc}</Text>
                  </div>
                </div>
              ))}
            </Section>

            <Text style={text}>Log in to your account to access the admin panel.</Text>

            <Section style={btnRow}>
              <Button href={dashboardUrl} style={btnPrimary}>Go to Dashboard</Button>
            </Section>

            <Text style={warningText}>
              If you did not expect this, please contact support immediately at support@vielinks.app.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footerSection}>
            <Text style={footer}>&copy; {new Date().getFullYear()} Vielinks. All rights reserved.</Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties            = { backgroundColor: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', margin: '0 auto', padding: '0 8px' };
const container: React.CSSProperties       = { maxWidth: '520px', margin: '40px auto', padding: '32px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e5e7eb' };
const logoSection: React.CSSProperties     = { marginBottom: '24px' };
const logo: React.CSSProperties            = { color: '#111827', fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.5px' };
const hr: React.CSSProperties              = { borderColor: '#e5e7eb', margin: '0' };
const contentSection: React.CSSProperties  = { padding: '28px 0' };
const badge: React.CSSProperties           = { background: '#f0fdf4', borderLeft: '4px solid #16a34a', padding: '10px 16px', borderRadius: '0 8px 8px 0', marginBottom: '24px' };
const badgeText: React.CSSProperties       = { color: '#16a34a', fontWeight: 700, fontSize: '13px', margin: 0 };
const heading: React.CSSProperties         = { color: '#111827', fontSize: '22px', fontWeight: 600, margin: '0 0 12px', padding: 0 };
const text: React.CSSProperties            = { color: '#374151', fontSize: '14px', lineHeight: '24px', margin: '0 0 12px' };
const capabilitiesBox: React.CSSProperties = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '8px 16px', margin: '16px 0 20px' };
const capRow: React.CSSProperties          = { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '8px 0' };
const capIcon: React.CSSProperties         = { fontSize: '18px', margin: '2px 0 0', width: '24px', flexShrink: 0 };
const capLabel: React.CSSProperties        = { color: '#111827', fontSize: '13px', fontWeight: 600, margin: '0 0 2px' };
const capDesc: React.CSSProperties         = { color: '#6b7280', fontSize: '12px', margin: 0, lineHeight: '18px' };
const btnRow: React.CSSProperties          = { margin: '4px 0 20px' };
const btnPrimary: React.CSSProperties      = { backgroundColor: '#111827', color: '#ffffff', fontSize: '14px', fontWeight: 600, padding: '12px 28px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block' };
const warningText: React.CSSProperties     = { color: '#9ca3af', fontSize: '12px', lineHeight: '20px', margin: '0 0 8px', fontStyle: 'italic' };
const footerSection: React.CSSProperties   = { paddingTop: '20px' };
const footer: React.CSSProperties          = { color: '#9ca3af', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
