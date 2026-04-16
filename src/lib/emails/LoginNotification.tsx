import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Link,
  Preview,
  Heading,
} from '@react-email/components';

interface LoginNotificationProps {
  email:             string;
  name?:             string;
  loginTime:         string;
  loginDate:         string;
  changePasswordUrl: string;
}

export function LoginNotification({
  email,
  name,
  loginTime,
  loginDate,
  changePasswordUrl,
}: LoginNotificationProps) {
  const displayName = name ?? email;

  return (
    <Html lang="en">
      <Head />
      <Preview>New sign-in to your Vielink account</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Heading style={heading}>New sign-in detected</Heading>

          <Text style={text}>Hi <strong>{displayName}</strong>,</Text>
          <Text style={text}>
            A new sign-in to your Vielink account was detected.
          </Text>

          <Text style={detailRow}>
            <span style={detailKey}>Account</span>
            <span style={detailVal}>{email}</span>
          </Text>
          <Text style={detailRow}>
            <span style={detailKey}>Date</span>
            <span style={detailVal}>{loginDate}</span>
          </Text>
          <Text style={detailRow}>
            <span style={detailKey}>Time</span>
            <span style={detailVal}>{loginTime}</span>
          </Text>

          <Hr style={hrThin} />

          <Text style={text}>
            If this was you, no action is required.
          </Text>
          <Text style={text}>
            If this wasn&apos;t you,{' '}
            <Link href={changePasswordUrl} style={link}>
              change your password immediately
            </Link>{' '}
            to secure your account.
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            If you&apos;d like to report an issue, reach out to{' '}
            <Link href="mailto:support@vielink.app" style={footerLink}>
              Vielink Support
            </Link>
            .
          </Text>
          <Text style={footer}>
            Copyright &copy; {new Date().getFullYear()} Vielink. All rights reserved.
          </Text>

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

const container: React.CSSProperties = {
  maxWidth: '465px',
  margin: '40px auto',
  padding: '20px',
};

const logoSection: React.CSSProperties = {
  marginBottom: '24px',
};

const logo: React.CSSProperties = {
  color: '#000000',
  fontSize: '20px',
  fontWeight: 700,
  margin: 0,
  letterSpacing: '-0.5px',
};

const heading: React.CSSProperties = {
  color: '#000000',
  fontSize: '24px',
  fontWeight: 400,
  margin: '0 0 30px',
  padding: 0,
};

const text: React.CSSProperties = {
  color: '#000000',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '0 0 10px',
};

const detailRow: React.CSSProperties = {
  color: '#000000',
  fontSize: '14px',
  lineHeight: '24px',
  margin: '0 0 4px',
};

const detailKey: React.CSSProperties = {
  color: '#666666',
  display: 'inline-block',
  width: '60px',
  fontSize: '14px',
};

const detailVal: React.CSSProperties = {
  color: '#000000',
  fontSize: '14px',
};

const link: React.CSSProperties = {
  color: '#000000',
  textDecoration: 'underline',
};

const hrThin: React.CSSProperties = {
  borderColor: '#eaeaea',
  margin: '16px 0',
};

const hr: React.CSSProperties = {
  borderColor: '#eaeaea',
  margin: '26px 0',
};

const footer: React.CSSProperties = {
  color: '#666666',
  fontSize: '12px',
  lineHeight: '20px',
  margin: '0 0 4px',
};

const footerLink: React.CSSProperties = {
  color: '#666666',
  textDecoration: 'underline',
};
