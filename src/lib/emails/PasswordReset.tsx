import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Link, Preview, Heading,
} from '@react-email/components';

interface PasswordResetProps {
  email: string;
  code:  string;
}

export function PasswordReset({ email, code }: PasswordResetProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your Vielink password reset code: {code}</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>
            <Heading style={heading}>Reset your password</Heading>
            <Text style={text}>
              We received a request to reset the password for <strong>{email}</strong>.
              Enter the code below to continue.
            </Text>

            <Section style={codeBox}>
              <Text style={codeText}>{code}</Text>
            </Section>

            <Text style={subText}>
              This code expires in <strong>1 minute</strong>. If you did not request a password reset, you can safely ignore this email.
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

const body: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  margin: '0 auto',
  padding: '0 8px',
};
const container: React.CSSProperties = { maxWidth: '465px', margin: '40px auto', padding: '20px' };
const logoSection: React.CSSProperties = { marginBottom: '24px' };
const logo: React.CSSProperties = { color: '#000000', fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.5px' };
const hr: React.CSSProperties = { borderColor: '#eaeaea', margin: '0' };
const contentSection: React.CSSProperties = { padding: '32px 0' };
const heading: React.CSSProperties = { color: '#000000', fontSize: '24px', fontWeight: 400, margin: '0 0 16px', padding: 0 };
const text: React.CSSProperties = { color: '#000000', fontSize: '14px', lineHeight: '24px', margin: '0 0 24px' };
const codeBox: React.CSSProperties = { margin: '0 0 24px' };
const codeText: React.CSSProperties = {
  color: '#000000',
  fontSize: '36px',
  fontWeight: 700,
  letterSpacing: '8px',
  margin: 0,
  textAlign: 'center' as const,
};
const subText: React.CSSProperties = { color: '#666666', fontSize: '13px', lineHeight: '22px', margin: 0 };
const footerSection: React.CSSProperties = { paddingTop: '20px' };
const footer: React.CSSProperties = { color: '#666666', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
const footerLink: React.CSSProperties = { color: '#666666', textDecoration: 'underline' };
