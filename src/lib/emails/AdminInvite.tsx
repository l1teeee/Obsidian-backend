import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Link, Preview, Heading, Button,
} from '@react-email/components';

export interface AdminInviteProps {
  name?:      string;
  email:      string;
  addedBy?:   string;
  acceptUrl:  string;
  rejectUrl:  string;
}

const CAPABILITIES = [
  { icon: '📊', label: 'Platform Overview',  desc: 'Real-time stats, charts, and top workspace rankings.' },
  { icon: '👥', label: 'User Management',    desc: 'Search, activate, and deactivate any user account.' },
  { icon: '🗂️', label: 'Workspace Control',  desc: 'Inspect and toggle the status of all workspaces.' },
  { icon: '📝', label: 'Post Moderation',    desc: 'Review, activate, or deactivate posts across all users.' },
  { icon: '🛡️', label: 'Admin Management',   desc: 'Add or remove platform administrators.' },
];

export function AdminInvite({ name, addedBy, acceptUrl, rejectUrl }: AdminInviteProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>You have been invited to become an administrator on Vielink</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>
            <div style={badge}>
              <Text style={badgeText}>Admin Invitation</Text>
            </div>

            <Heading style={heading}>Hi {name ?? 'there'},</Heading>

            <Text style={text}>
              {addedBy
                ? <><strong>{addedBy}</strong> has invited you to become an administrator on the Vielink platform.</>
                : <>You have been invited to become an administrator on the Vielink platform.</>
              }
            </Text>

            <Text style={text}>As an admin you will have access to:</Text>

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

            <Text style={text}>Do you accept this invitation?</Text>

            <Section style={btnRow}>
              <Button href={acceptUrl} style={btnAccept}>Accept Invitation</Button>
              <Button href={rejectUrl} style={btnReject}>Decline</Button>
            </Section>

            <Text style={warningText}>
              This invitation link expires in 72 hours. Admin access gives significant control over the platform — only accept if you authorized this.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footerSection}>
            <Text style={footer}>
              If you did not expect this, please{' '}
              <Link href="mailto:support@vielink.app" style={footerLink}>contact support</Link>.
            </Text>
            <Text style={footer}>&copy; {new Date().getFullYear()} Vielink. All rights reserved.</Text>
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
const badge: React.CSSProperties           = { background: '#fef2f2', borderLeft: '4px solid #dc2626', padding: '10px 16px', borderRadius: '0 8px 8px 0', marginBottom: '24px' };
const badgeText: React.CSSProperties       = { color: '#dc2626', fontWeight: 700, fontSize: '13px', margin: 0 };
const heading: React.CSSProperties         = { color: '#111827', fontSize: '22px', fontWeight: 600, margin: '0 0 12px', padding: 0 };
const text: React.CSSProperties            = { color: '#374151', fontSize: '14px', lineHeight: '24px', margin: '0 0 12px' };
const capabilitiesBox: React.CSSProperties = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '8px 16px', margin: '16px 0 20px' };
const capRow: React.CSSProperties          = { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '8px 0' };
const capIcon: React.CSSProperties         = { fontSize: '18px', margin: '2px 0 0', width: '24px', flexShrink: 0 };
const capLabel: React.CSSProperties        = { color: '#111827', fontSize: '13px', fontWeight: 600, margin: '0 0 2px' };
const capDesc: React.CSSProperties         = { color: '#6b7280', fontSize: '12px', margin: 0, lineHeight: '18px' };
const btnRow: React.CSSProperties          = { display: 'flex', gap: '12px', margin: '4px 0 20px' };
const btnAccept: React.CSSProperties       = { backgroundColor: '#111827', color: '#ffffff', fontSize: '14px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block' };
const btnReject: React.CSSProperties       = { backgroundColor: '#f3f4f6', color: '#374151', fontSize: '14px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block' };
const warningText: React.CSSProperties     = { color: '#9ca3af', fontSize: '12px', lineHeight: '20px', margin: '0 0 8px', fontStyle: 'italic' };
const footerSection: React.CSSProperties   = { paddingTop: '20px' };
const footer: React.CSSProperties          = { color: '#9ca3af', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
const footerLink: React.CSSProperties      = { color: '#9ca3af', textDecoration: 'underline' };
