import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Link, Preview, Heading, Button,
} from '@react-email/components';

export interface AccountStatusChangedProps {
  name?:   string;
  action:  'activated' | 'deactivated';
  reason:  string;
  loginUrl: string;
}

export function AccountStatusChanged({ name, action, reason, loginUrl }: AccountStatusChangedProps) {
  const isDeactivated = action === 'deactivated';

  return (
    <Html lang="en">
      <Head />
      <Preview>
        Your Vielink account has been {action} by an administrator
      </Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>

            <div style={{
              background: isDeactivated ? '#fef2f2' : '#f0fdf4',
              borderLeft: `4px solid ${isDeactivated ? '#dc2626' : '#16a34a'}`,
              padding: '12px 16px',
              borderRadius: '0 8px 8px 0',
              marginBottom: '24px',
            }}>
              <Text style={{ ...text, margin: 0, fontWeight: 600, color: isDeactivated ? '#dc2626' : '#16a34a' }}>
                Account {isDeactivated ? 'Deactivated' : 'Reactivated'}
              </Text>
            </div>

            <Heading style={heading}>
              Hi {name ?? 'there'},
            </Heading>

            <Text style={text}>
              Your Vielink account has been <strong>{action}</strong> by a platform administrator.
            </Text>

            <Section style={reasonBox}>
              <Text style={{ ...smallLabel, marginBottom: '4px' }}>Reason</Text>
              <Text style={{ ...text, margin: 0, fontStyle: 'italic', color: '#374151' }}>
                &ldquo;{reason}&rdquo;
              </Text>
            </Section>

            <Hr style={hrThin} />

            {isDeactivated ? (
              <>
                <Text style={text}>
                  While your account is deactivated you will not be able to sign in or access any of your data.
                  If you believe this was a mistake, please{' '}
                  <Link href="mailto:support@vielink.app" style={link}>contact our support team</Link>.
                </Text>
              </>
            ) : (
              <>
                <Text style={text}>
                  Your account has been restored and you can sign in again. All your workspaces and posts are intact.
                </Text>
                <Button href={loginUrl} style={btnPrimary}>
                  Sign in to Vielinks
                </Button>
              </>
            )}
          </Section>

          <Hr style={hr} />

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

const body: React.CSSProperties        = { backgroundColor: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', margin: '0 auto', padding: '0 8px' };
const container: React.CSSProperties   = { maxWidth: '520px', margin: '40px auto', padding: '32px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e5e7eb' };
const logoSection: React.CSSProperties = { marginBottom: '24px' };
const logo: React.CSSProperties        = { color: '#111827', fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.5px' };
const hr: React.CSSProperties          = { borderColor: '#e5e7eb', margin: '0' };
const hrThin: React.CSSProperties      = { borderColor: '#f3f4f6', margin: '20px 0' };
const contentSection: React.CSSProperties = { padding: '28px 0' };
const heading: React.CSSProperties     = { color: '#111827', fontSize: '22px', fontWeight: 600, margin: '0 0 12px', padding: 0 };
const text: React.CSSProperties        = { color: '#374151', fontSize: '14px', lineHeight: '24px', margin: '0 0 12px' };
const smallLabel: React.CSSProperties  = { color: '#6b7280', fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 };
const reasonBox: React.CSSProperties   = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 16px', margin: '16px 0 20px' };
const link: React.CSSProperties        = { color: '#2563eb', textDecoration: 'underline', fontSize: '14px' };
const btnPrimary: React.CSSProperties  = { backgroundColor: '#111827', color: '#ffffff', fontSize: '14px', fontWeight: 600, padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block', margin: '8px 0' };
const footerSection: React.CSSProperties = { paddingTop: '20px' };
const footer: React.CSSProperties      = { color: '#9ca3af', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
const footerLink: React.CSSProperties  = { color: '#9ca3af', textDecoration: 'underline' };
