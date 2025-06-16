import React, { useState, useEffect } from 'react';
import {
    Form,
    Input,
    Button,
    Typography,
    message,
    Row,
    Col,
    DatePicker,
    Select,
    Spin,
    Avatar,
    Upload,
} from 'antd';
import { UserOutlined, MailOutlined, PhoneOutlined, HomeOutlined, ShopOutlined, ToolOutlined, LockOutlined, UploadOutlined } from '@ant-design/icons';
import { supabase } from '../lib/supabase'; // Supabase klientinizin yolu
import InputMask from "react-input-mask";
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;
const { Option } = Select;

// Profil məlumatlarının interfeysi
interface ProfileData {
    id: string;
    name: string;
    email: string | null;
    phone_number: string | null;
    address: string | null;
    birth_date: string | null;
    company_name: string | null;
    experience_years: number;
    specialties: string[];
    avatar_url: string | null;
    role: string; // "user" və ya "provider"
}

interface ServiceCategory {
    id: string;
    label: string; // Tutaq ki, kateqoriya adı 'label' sütununda saxlanır
    // Digər sütunlar da ola bilər (məsələn: uuid)
}

export function ProfilePage() {
    const [form] = Form.useForm(); // Profil məlumatları üçün form
    const [passwordForm] = Form.useForm(); // Parol dəyişikliyi üçün form
    const [loading, setLoading] = useState(true); // Məlumat yüklənmə statusu
    const [saving, setSaving] = useState(false); // Yadda saxlama statusu
    const [userProfile, setUserProfile] = useState<ProfileData | null>(null); // Cari istifadəçi profili
    const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null); // Cari avatar URL-i
    const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>([]); // Xidmət kateqoriyaları
    const navigate = useNavigate(); // Səhifələr arasında keçid üçün

    // Səhifə yüklənəndə profil və kateqoriya məlumatlarını gətir
    useEffect(() => {
        fetchProfile();
        fetchServiceCategories(); // Yeni funksiya çağırışı
    }, []);

    // Profil məlumatlarını Supabase-dən gətirir
    const fetchProfile = async () => {
        setLoading(true);
        try {
            // Cari daxil olmuş istifadəçini yoxla
            const { data: { user }, error: userError } = await supabase.auth.getUser();

            if (userError || !user) {
                message.error('İstifadəçi daxil olmayıb. Zəhmət olmasa, giriş edin.');
                navigate('/login'); // Daxil olunmayıbsa, giriş səhifəsinə yönləndir
                return;
            }

            // 'profiles' cədvəlindən istifadəçi məlumatlarını al
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) {
                console.error('Profil yüklənərkən xəta:', error);
                message.error('Profil məlumatları yüklənərkən xəta baş verdi.');
            } else if (data) {
                // Məlumatlar uğurla gətirildikdə state-ləri yenilə
                setUserProfile(data);
                setCurrentAvatarUrl(data.avatar_url);
                // Form sahələrini gətirilən məlumatlarla doldur
                form.setFieldsValue({
                    name: data.name,
                    email: data.email,
                    phone_number: data.phone_number ? `+${data.phone_number}` : '', // Telefon nömrəsini düzgün formatda göstər
                    address: data.address,
                    birthDate: data.birth_date ? dayjs(data.birth_date) : null,
                    company: data.company_name,
                    experience: data.experience_years,
                    specialties: data.specialties,
                });
            }
        } catch (error) {
            console.error('Profil yüklənərkən gözlənilməyən xəta:', error);
            message.error('Profil məlumatları yüklənərkən gözlənilməyən xəta baş verdi.');
        } finally {
            setLoading(false); // Yüklənmə bitdi
        }
    };

    // service_categories cədvəlindən kateqoriyaları gətirir
    const fetchServiceCategories = async () => {
        try {
            const { data, error } = await supabase
                .from('service_categories')
                .select('id, label') // Yalnız id və label sütunlarını seçin
                .order('label', { ascending: true }); // Əlifba sırası ilə düzün

            if (error) {
                console.error('Xidmət kateqoriyaları yüklənərkən xəta:', error);
                message.error('Xidmət kateqoriyaları yüklənərkən xəta baş verdi.');
            } else if (data) {
                setServiceCategories(data as ServiceCategory[]);
            }
        } catch (error) {
            console.error('Xidmət kateqoriyaları yüklənərkən gözlənilməyən xəta:', error);
            message.error('Xidmət kateqoriyaları yüklənərkən gözlənilməyən xəta baş verdi.');
        }
    };


    // Profil məlumatlarını yeniləyir
    const handleUpdateProfile = async (values: any) => {
        setSaving(true);
        // Ən son istifadəçi məlumatlarını Supabase auth-dan al
        const { data: { user } } = await supabase.auth.getUser();

        // İstifadəçi daxil olunmayıbsa və ya profil məlumatları yoxdursa
        if (!user || !userProfile) {
            message.error('Profil məlumatları yüklənməyib və ya istifadəçi daxil olmayıb. Zəhmət olmasa, səhifəni yeniləyin və ya təkrar daxil olun.');
            setSaving(false);
            return;
        }

        try {
            // Telefon nömrəsini təmizlə və formatını yoxla
            let rawPhoneNumber = values.phone_number ? String(values.phone_number).replace(/\D/g, '') : null;
            if (rawPhoneNumber && (rawPhoneNumber.length !== 12 || !rawPhoneNumber.startsWith('994'))) {
                message.error('Telefon nömrəsini düzgün daxil edin. Məsələn: +994501234567');
                setSaving(false);
                return;
            }

            // 'profiles' cədvəli üçün yenilənəcək məlumatlar
            const updatedProfileData: Partial<ProfileData> = {
                name: values.name,
                email: values.email || null,
                phone_number: rawPhoneNumber,
                address: values.address || null,
                birth_date: values.birthDate ? values.birthDate.format('YYYY-MM-DD') : null,
                company_name: values.company || null,
                experience_years: values.experience ? parseInt(values.experience) : 0,
                specialties: Array.isArray(values.specialties) ? values.specialties : [],
            };

            // 'profiles' cədvəlini yenilə
            const { error: profileUpdateError } = await supabase
                .from('profiles')
                .update(updatedProfileData)
                .eq('id', userProfile.id);

            if (profileUpdateError) {
                throw profileUpdateError;
            }

            // 'auth.users' üçün user_metadata-nı yenilə
            const authUserMetadataUpdate: { [key: string]: any } = {};
            if (values.name !== user.user_metadata?.name) authUserMetadataUpdate.name = values.name;
            if (values.address !== user.user_metadata?.address) authUserMetadataUpdate.address = values.address;
            if (values.birthDate?.format('YYYY-MM-DD') !== user.user_metadata?.birth_date) authUserMetadataUpdate.birth_date = values.birthDate ? values.birthDate.format('YYYY-MM-DD') : null;
            if (values.company !== user.user_metadata?.company_name) authUserMetadataUpdate.company_name = values.company;
            if (values.experience !== user.user_metadata?.experience_years) authUserMetadataUpdate.experience_years = values.experience ? parseInt(values.experience) : 0;
            // Xüsusiyyətlərin dəyişib-dəyişmədiyini yoxlayarkən, mövcud və yeni dəyərləri müqayisə edin
            if (JSON.stringify(values.specialties.sort()) !== JSON.stringify((user.user_metadata?.specialties || []).sort())) {
                authUserMetadataUpdate.specialties = Array.isArray(values.specialties) ? values.specialties : [];
            }


            // Email dəyişibsə və ya metadata yenilənməyibsə, auth.updateUser çağır
            const authUpdateOptions: { email?: string; data?: { [key: string]: any } } = {};
            if (values.email && values.email !== user.email) {
                authUpdateOptions.email = values.email; // Email dəyişibsə, email sahəsini əlavə et
            }
            if (Object.keys(authUserMetadataUpdate).length > 0) {
                authUpdateOptions.data = authUserMetadataUpdate; // Metadata varsa, data sahəsini əlavə et
            }

            if (Object.keys(authUpdateOptions).length > 0) {
                const { error: authUserUpdateError } = await supabase.auth.updateUser(authUpdateOptions);

                if (authUserUpdateError) {
                    // Email dəyişikliyi təsdiq tələb edirsə
                    if (authUserUpdateError.message.includes('email change requires confirmation')) {
                        message.warning('Email ünvanı dəyişdirildi. Yeni email ünvanınızı təsdiq etmək üçün sizə təsdiq linki göndərildi.');
                    } else {
                        console.error('Auth istifadəçisi yenilənərkən xəta:', authUserUpdateError);
                        message.error('Auth istifadəçisi yenilənərkən xəta baş verdi: ' + authUserUpdateError.message);
                    }
                }
            }

            message.success('Profil məlumatları uğurla yeniləndi!');
            await fetchProfile(); // UI-ni yeniləmək üçün profil məlumatlarını yenidən gətir
        } catch (err: any) {
            console.error('Profil yenilənərkən xəta:', err);
            message.error('Profil yenilənərkən xəta baş verdi: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // Parolu dəyişdirir
    const handlePasswordChange = async (values: any) => {
        setSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                message.error('Parol dəyişdirmək üçün daxil olmalısınız.');
                setSaving(false);
                return;
            }

            if (values.password !== values.confirmPassword) {
                message.error('Parollar uyğun gəlmir!');
                setSaving(false);
                return;
            }
            // Supabase auth-da parolu yenilə
            const { error } = await supabase.auth.updateUser({
                password: values.password
            });

            if (error) {
                throw error;
            }
            message.success('Parol uğurla dəyişdirildi!');
            passwordForm.resetFields(); // Form sahələrini təmizlə
        } catch (err: any) {
            console.error('Parol dəyişdirilərkən xəta:', err);
            message.error('Parol dəyişdirilərkən xəta baş verdi: ' + err.message);
        } finally {
            setSaving(false);
        }
    };
    // Yüklənmə zamanı Spin (yüklənmə animasiyası) göstər
    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-screen bg-gray-50">
                <Spin size="large" tip="Məlumatlar yüklənir..." />
            </div>
        );
    }

    return (
        <div className="bg-white rounded-3xl shadow-xl max-w-4xl w-full p-8 sm:p-10 lg:p-12 mb-8">
            {/* Səhifə Başlığı */}
            <Title level={2} className="text-center mb-5 font-bold text-gray-800 tracking-wide">
                Profil Ayarları
            </Title>

            {/* Şəxsi Məlumatlar Bölməsi */}
            <div className="mb-12 p-6 bg-blue-50 rounded-xl shadow-inner">
                <Title level={3} className="mb-8 font-semibold text-gray-800 text-center relative pb-3">
                    Şəxsi Məlumatlar
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-400 rounded-full"></span>
                </Title>
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleUpdateProfile}
                    initialValues={userProfile || {}}
                >
                    <Row gutter={[32, 24]}> {/* Sahələr arası geniş məsafə */}
                        <Col xs={24} md={12}>
                            <Form.Item name="name" label={<Text strong>Ad Soyad</Text>} rules={[{ required: true, message: 'Adınızı daxil edin!' }]}>
                                <Input
                                    prefix={<UserOutlined className="text-blue-400" />}
                                    placeholder="Adınız və soyadınız"
                                    size="large"
                                    className="rounded-md"
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="email" label={<Text strong>Email</Text>} rules={[{ type: 'email', message: 'Düzgün email daxil edin!' }]}>
                                <Input
                                    prefix={<MailOutlined className="text-blue-400" />}
                                    placeholder="email@example.com"
                                    size="large"
                                    className="rounded-md"
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="phone_number" label={<Text strong>Telefon Nömrəsi</Text>} rules={[{ required: true, message: 'Telefon nömrəsi vacibdir!' }]}>
                                <InputMask mask="+994(99)9999999" maskChar={null}>
                                    {(inputProps: any) => (
                                        <Input {...inputProps}
                                            prefix={<PhoneOutlined className="text-blue-400" />}
                                            placeholder="+994(XX)XXX-XX-XX"
                                            size="large"
                                            className="rounded-md"
                                        />
                                    )}
                                </InputMask>
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="birthDate" label={<Text strong>Doğum Tarixi</Text>}>
                                <DatePicker
                                    style={{ width: '100%' }}
                                    format="YYYY-MM-DD"
                                    size="large"
                                    className="rounded-md"
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24}>
                            <Form.Item name="address" label={<Text strong>Ünvan</Text>}>
                                <Input prefix={<HomeOutlined className="text-blue-400" />} placeholder="Ünvanınızı daxil edin" size="large" className="rounded-md" />
                            </Form.Item>
                        </Col>

                        {/* Provider roluna aid sahələr */}
                        {userProfile?.role === 'provider' && (
                            <>
                                <Col xs={24} md={12}>
                                    <Form.Item name="company" label={<Text strong>Şirkət Adı (əgər varsa)</Text>}>
                                        <Input
                                            prefix={<ShopOutlined className="text-blue-400" />}
                                            placeholder="Şirkət adı"
                                            size="large"
                                            className="rounded-md"
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="experience" label={<Text strong>Təcrübə (il)</Text>}>
                                        <Input
                                            type="number"
                                            prefix={<ToolOutlined className="text-blue-400" />}
                                            placeholder="Təcrübə müddəti"
                                            min={0}
                                            size="large"
                                            className="rounded-md"
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24}>
                                    <Form.Item name="specialties" label={<Text strong>İxtisaslar</Text>} tooltip="Xidmət göstərdiyiniz sahələri seçin">
                                        <Select
                                            mode="multiple"
                                            placeholder="İxtisas(lar) seçin"
                                            size="large"
                                            className="rounded-md"
                                        >
                                            {serviceCategories.map(category => (
                                                <Option key={category.id} value={category.label}>
                                                    {category.label}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                            </>
                        )}
                    </Row>
                    <Form.Item className="mt-8">
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={saving}
                            block
                            size="large"
                            className="rounded-full shadow-lg hover:shadow-xl transition-all duration-300"
                            style={{ height: '50px', fontSize: '18px' }}
                        >
                            Məlumatları Yadda Saxla
                        </Button>
                    </Form.Item>
                </Form>
            </div>

            {/* Parol Dəyişdirmə Bölməsi */}
            <div className="mb-8 p-6 bg-white rounded-xl shadow-lg">
                <Title level={3} className="mb-8 font-semibold text-gray-800 text-center relative pb-3">
                    Parolu Dəyişdir
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-red-400 rounded-full"></span>
                </Title>
                <Form
                    form={passwordForm}
                    layout="vertical"
                    onFinish={handlePasswordChange}
                >
                    <Row gutter={[32, 24]}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name="password"
                                label={<Text strong>Yeni Parol</Text>}
                                rules={[
                                    { required: true, message: 'Yeni parol daxil edin!' },
                                    { min: 6, message: 'Parol minimum 6 simvol olmalıdır!' },
                                ]}
                                hasFeedback
                            >
                                <Input.Password
                                    prefix={<LockOutlined className="text-red-400" />}
                                    placeholder="••••••"
                                    size="large"
                                    className="rounded-md"
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name="confirmPassword"
                                label={<Text strong>Parolu Təkrarla</Text>}
                                dependencies={['password']}
                                hasFeedback
                                rules={[
                                    { required: true, message: 'Parolu təsdiqləyin!' },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue('password') === value) {
                                                return Promise.resolve();
                                            }
                                            return Promise.reject(new Error('Daxil etdiyiniz iki parol uyğun gəlmir!'));
                                        },
                                    }),
                                ]}
                            >
                                <Input.Password
                                    prefix={<LockOutlined className="text-red-400" />}
                                    placeholder="••••••"
                                    size="large"
                                    className="rounded-md"
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24}> {/* Düyməni bütün eni tutması üçün əlavə Col */}
                            <Form.Item className="mt-8">
                                <Button
                                    type="default"
                                    htmlType="submit"
                                    loading={saving}
                                    block
                                    size="large"
                                    className="rounded-full shadow-lg hover:shadow-xl transition-all duration-300 border-red-500 text-red-500 hover:text-red-700 hover:border-red-700"
                                    style={{ height: '50px', fontSize: '18px' }}
                                >
                                    Parolu Dəyişdir
                                </Button>
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </div>
        </div>
    );
}