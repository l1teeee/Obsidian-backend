import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Hr, Link, Preview, Heading, Button,
} from '@react-email/components';

interface TrialEndingSoonProps {
  name?:        string;
  daysLeft:     number;
  subscribeUrl: string;
}

export function TrialEndingSoon({ name, daysLeft, subscribeUrl }: TrialEndingSoonProps) {
  const dayWord = daysLeft === 1 ? 'day' : 'days';
  return (
    <Html lang="en">
      <Head />
      <Preview>Your Vielink free trial ends in {String(daysLeft)} {dayWord}</Preview>
      <Body style={body}>
        <Container style={container}>

          <Section style={logoSection}>
            <Text style={logo}>Vielink</Text>
          </Section>

          <Hr style={hr} />

          <Section style={contentSection}>
            <Heading style={heading}>Your free trial ends in {daysLeft} {dayWord}</Heading>
            <Text style={text}>
              {name ? `Hi ${name}, ` : 'Hi, '}
              your 14-day Vielink trial is almost over. Subscribe now to keep
              publishing and scheduling to your social accounts without interruption.
            </Text>

            <Section style={buttonSection}>
              <Button href={subscribeUrl} style={button}>Choose a plan</Button>
            </Section>

            <Text style={subText}>
              After your trial ends you will still be able to sign in and manage
              your account, but publishing will be paused until you subscribe.
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
const buttonSection: React.CSSProperties = { margin: '0 0 24px', textAlign: 'center' as const };
const button: React.CSSProperties = {
  backgroundColor: '#000000',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600,
  padding: '12px 24px',
  textDecoration: 'none',
};
const subText: React.CSSProperties = { color: '#666666', fontSize: '13px', lineHeight: '22px', margin: 0 };
const footerSection: React.CSSProperties = { paddingTop: '20px' };
const footer: React.CSSProperties = { color: '#666666', fontSize: '12px', lineHeight: '20px', margin: '0 0 4px' };
const footerLink: React.CSSProperties = { color: '#666666', textDecoration: 'underline' };
