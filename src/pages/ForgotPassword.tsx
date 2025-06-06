import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Phone, ArrowLeft, KeyRound } from 'lucide-react'; // Added KeyRound for new password
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { message as antMessage, Form, Input, Button } from 'antd';
import InputMask from "react-input-mask";

export function ForgotPassword() {
  const { t } = useTranslation();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const handleSendOtp = async (values: any) => {
    setLoading(true);
    try {
      const formattedPhoneNumber = values.phone_number.replace(/\D/g, '');
      const finalPhoneNumber = formattedPhoneNumber.startsWith('+') ? formattedPhoneNumber : `+${formattedPhoneNumber}`;

      // Call the custom Edge Function to request OTP
      const { data, error } = await supabase.functions.invoke('request-password-reset', {
        body: {
          phone_number: finalPhoneNumber,
        },
      });

      if (error) {
        console.error('Edge Function error (request-password-reset):', error);
        antMessage.error(`Kodu göndərərkən xəta: Serverdə problem yarandı.`);
        return;
      }

      if (data && data.success) {
        setPhoneNumber(finalPhoneNumber); // Store for the next step
        setOtpSent(true);
        antMessage.success(data.message || 'Təsdiq kodu telefon nömrənizə göndərildi.');
      } else {
        antMessage.error(data?.message || 'Kodu göndərərkən xəta baş verdi.');
      }

    } catch (err) {
      console.error('Unexpected error sending OTP:', err);
      antMessage.error('Gözlənilməz xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpAndSetNewPassword = async (values: any) => {
    setLoading(true);
    try {
      // Call the custom Edge Function to verify OTP and reset password
      const { data, error } = await supabase.functions.invoke('verify-reset-code-and-set-password', {
        body: {
          phone_number: phoneNumber, // Use the stored phone number
          otp_code: values.otp,
          new_password: values.new_password,
        },
      });

      if (error) {
        console.error('Edge Function error (verify-reset-code-and-set-password):', error);
        antMessage.error(`Parolu yeniləyərkən xəta: Serverdə problem yarandı.`);
        return;
      }

      if (data && data.success) {
        antMessage.success(data.message || 'Parol uğurla yeniləndi! İndi daxil ola bilərsiniz.');
        navigate('/login');
      } else {
        antMessage.error(data?.message || 'Kod yanlışdır və ya vaxtı bitib.');
      }

    } catch (err) {
      console.error('Unexpected error during password reset:', err);
      antMessage.error('Gözlənilməz xəta baş verdi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {t('forgotPassword.title')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {otpSent ? t('forgotPassword.enterOtpAndNewPassword') : t('forgotPassword.phoneSubtitle')}
          </p>
        </div>

        {!otpSent ? (
          <Form
            form={form}
            name="send_otp_form"
            layout="vertical"
            onFinish={handleSendOtp}
            requiredMark={false}
          >
            <Form.Item
              name="phone_number"
              label={t('forgotPassword.phoneLabel')}
              rules={[
                { required: true, message: t('forgotPassword.phoneRequired') },
                ({ }) => ({
                  validator(_, value) {
                    const raw = value ? value.replace(/\D/g, '') : '';
                    if (!value || (raw.length === 12 && value.startsWith('+994'))) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error(t('forgotPassword.phoneInvalid')));
                  },
                }),
              ]}
            >
              <InputMask
                mask="+994999999999"
                maskChar="_"
                alwaysShowMask={false}
                value={form.getFieldValue('phone_number')}
                onChange={(e) => form.setFieldsValue({ phone_number: e.target.value })}
              >
                {(inputProps: any) => (
                  <Input
                    {...inputProps}
                    prefix={<Phone className="h-5 w-5 text-gray-400" />}
                    placeholder="+994XXXXXXXXX"
                    size="large"
                  />
                )}
              </InputMask>
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                size="large"
                block
              >
                {loading ? t('forgotPassword.sending') : t('forgotPassword.sendOtp')}
              </Button>
            </Form.Item>
          </Form>
        ) : (
          <Form
            form={form}
            name="verify_otp_and_reset_password_form"
            layout="vertical"
            onFinish={handleVerifyOtpAndSetNewPassword}
            requiredMark={false}
          >
            <Form.Item
              name="otp"
              label={t('forgotPassword.otpLabel')}
              rules={[{ required: true, message: t('forgotPassword.otpRequired') }]}
            >
              <Input
                prefix={<KeyRound className="h-5 w-5 text-gray-400" />} // Changed to KeyRound for OTP
                placeholder={t('forgotPassword.otpPlaceholder')}
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="new_password"
              label={t('forgotPassword.newPasswordLabel')}
              rules={[
                { required: true, message: t('forgotPassword.newPasswordRequired') },
                { min: 6, message: t('forgotPassword.passwordMinLength') },
              ]}
            >
              <Input.Password
                prefix={<KeyRound className="h-5 w-5 text-gray-400" />} // KeyRound for password
                placeholder={t('forgotPassword.newPasswordPlaceholder')}
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                size="large"
                block
              >
                {loading ? t('forgotPassword.resetting') : t('forgotPassword.resetPassword')}
              </Button>
            </Form.Item>
          </Form>
        )}

        <div className="text-center">
          <Link to="/login" className="text-indigo-600 hover:text-indigo-500 flex items-center justify-center">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('forgotPassword.backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  );
}