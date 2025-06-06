import React, { useState, useEffect, useMemo } from "react";
import InputMask from "react-input-mask";
import { supabase } from "../lib/supabase";
import {
  Select,
  Input,
  Button,
  Form,
  Space,
  Typography,
  Steps,
  message,
  Card,
  Result,
  Alert,
} from "antd"; // Import Ant Design components
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  EditOutlined,
  SmileOutlined, // For success state
  SolutionOutlined, // For questions step
  PaperClipOutlined, // For category/subcategory
  DollarOutlined, // For price
  PhoneOutlined, // For phone input
} from "@ant-design/icons"; // Import Ant Design icons

const { Option } = Select;
const { TextArea } = Input;
const { Title, Text } = Typography;

const stepsConfig = [
  {
    title: "Kateqoriya Seçimi",
    description: "Xidmətin növünü seçin",
    icon: <PaperClipOutlined />,
  },
  {
    title: "Məlumatların Daxil Edilməsi",
    description: "Tələb olunan detalları daxil edin",
    icon: <SolutionOutlined />,
  },
  {
    title: "Təsdiq",
    description: "Sorğunuzu nəzərdən keçirin",
    icon: <CheckCircleOutlined />,
  },
];

const DynamicServiceForm: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0); // 0: Start, 1: Category, 2: Details, 3: Confirm, 4: Success
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [servicePrices, setServicePrices] = useState<any[]>([]);
  const [category, setCategory] = useState<string>("");
  const [subcategory, setSubcategory] = useState<string>("");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm(); // Ant Design Form instance

  // --- Data Fetching ---
  useEffect(() => {
    setLoading(true);
    supabase
      .from("service_categories")
      .select("*")
      .then(({ data, error }) => {
        if (error) {
          message.error("Kateqoriyalar yüklənərkən xəta: " + error.message);
        } else {
          setCategories(data || []);
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (category) {
      setLoading(true);
      supabase
        .from("service_subcategories")
        .select("*")
        .eq("category_id", category)
        .then(({ data, error }) => {
          if (error) {
            message.error("Alt kateqoriyalar yüklənərkən xəta: " + error.message);
          } else {
            setSubcategories(data || []);
          }
          setLoading(false);
        });
      setSubcategory("");
      setQuestions([]);
      setServicePrices([]);
      setAnswers({});
      form.resetFields(); // Reset form fields when category changes
    }
  }, [category]);

  useEffect(() => {
    if (subcategory) {
      setLoading(true);
      supabase
        .from("service_questions")
        .select("*")
        .eq("category_id", category)
        .order("order_num", { ascending: true })
        .then(({ data, error }) => {
          if (error) {
            message.error("Suallar yüklənərkən xəta: " + error.message);
          } else {
            setQuestions(data || []);
          }
          setLoading(false);
        });
      supabase
        .from("service_prices")
        .select("*")
        .eq("category_id", category)
        .then(({ data, error }) => {
          if (error) {
            message.error("Qiymət məlumatları yüklənərkən xəta: " + error.message);
          } else {
            setServicePrices(data || []);
          }
          setLoading(false);
        });
      setAnswers({});
      form.resetFields(); // Reset form fields when subcategory changes
    } else {
      setQuestions([]);
      setAnswers({});
      setServicePrices([]);
      form.resetFields();
    }
  }, [subcategory, category]);

  const priceInfo = useMemo(() => {
    if (!servicePrices.length) return null;
    let min = 0,
      max = 0;

    for (const q of questions) {
      const ans = answers[q.name];
      if (ans) {
        const priceRow = servicePrices.find(
          (sp: any) => sp.question_name === q.name && String(sp.option_value) === String(ans) // Ensure type matching
        );
        if (priceRow) {
          min += Number(priceRow.min_price) || 0;
          max += Number(priceRow.max_price) || 0;
        }
      }
    }
    if (min === 0 && max === 0) return null;
    return { min, max };
  }, [answers, questions, servicePrices]);

  const onFormChange = (changedValues: any, allValues: any) => {
    // Update answers state
    setAnswers(allValues);
  };

  const handleNext = async () => {
    try {
      if (currentStep === 0) {
        if (!category || !subcategory) {
          message.warning("Zəhmət olmasa, kateqoriya və alt kateqoriya seçin.");
          return;
        }
      } else if (currentStep === 1) {
        // Validate current step's questions using Ant Design form validation
        await form.validateFields();
        // Check if all required questions have answers
        const allQuestionsAnswered = questions.every(
          (q: any) => !q.required || (answers[q.name] !== undefined && answers[q.name] !== null && answers[q.name] !== "")
        );
        if (!allQuestionsAnswered) {
          message.warning("Zəhmət olmasa, bütün tələb olunan məlumatları daxil edin.");
          return;
        }
      }
      setCurrentStep((prev) => prev + 1);
    } catch (info) {
      console.log('Validate Failed:', info);
      message.error("Zəhmət olmasa, formadakı səhvləri düzəldin.");
    }
  };

  const handlePrev = () => {
    setCurrentStep((prev) => prev - 1);
  };

  const handleSend = async () => {
    setLoading(true);
    try {
      const user = await supabase.auth.getUser();
      const userId = user.data.user?.id;

      if (!userId) {
        message.error("Xidmət sorğusu yaratmaq üçün daxil olmalısınız.");
        setLoading(false);
        return;
      }

      const { error: insertError } = await supabase.from("opportunities").insert([
        {
          title: answers.title || "Xidmət sorğusu",
          description: answers.description || "",
          created_by: userId,
          date: answers.date || new Date().toISOString().substring(0, 10),
          location: answers.location || "",
          category_id: category,
          subcategory_id: subcategory,
          budget: priceInfo ? priceInfo.max : (answers.budget ? Number(answers.budget) : null),
          extra_answers: JSON.stringify(answers),
        },
      ]);

      if (insertError) {
        message.error("Sorğu göndərilərkən xəta baş verdi: " + insertError.message);
      } else {
        message.success("Sorğunuz uğurla qəbul edildi!");
        setCurrentStep(stepsConfig.length + 1); // Go to success page (index 4)
      }
    } catch (err: any) {
      console.error("Sending error:", err);
      message.error("Gözlənilməz xəta baş verdi: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderInput = (q: any) => {
    let optionsArr: string[] = [];
    if (typeof q.options === "string") {
      try {
        optionsArr = JSON.parse(q.options);
      } catch {
        optionsArr = [];
      }
    } else if (Array.isArray(q.options)) {
      optionsArr = q.options;
    }

    const commonInputProps = {
      size: "large",
      style: { width: "100%" },
      placeholder: q.placeholder || q.label || q.question,
    };

    switch (q.type) {
      case "select":
        return (
          <Select {...commonInputProps} size="large">
            <Option value="" disabled>
              Seçin
            </Option>
            {optionsArr.map((opt: string) => (
              <Option value={opt} key={opt}>
                {opt}
              </Option>
            ))}
          </Select>
        );
      case "textarea":
        return <TextArea rows={4} {...commonInputProps} size="large"/>;
      case "tel":
        return (
          <InputMask
            mask="+994999999999"
            maskChar="_"
            value={answers[q.name]}
            onChange={(e) => form.setFieldsValue({ [q.name]: e.target.value })}
          >
            {(inputProps: any) => (
              <Input
                {...inputProps}
                prefix={<PhoneOutlined />}
                {...commonInputProps}
              />
            )}
          </InputMask>
        );
      case "date":
        return <Input type="date" {...commonInputProps} size="large" />;
      case "number":
        return <Input type="number" {...commonInputProps} size="large" />;
      default:
        return <Input type="text" {...commonInputProps} size="large" />;
    }
  };

  const currentStepIndexForIndicator = useMemo(() => {
    if (currentStep === 0) return 0; // "Start" page is step 0 for the user, but not on the indicator
    return currentStep - 1; // Adjust for the "Start" page
  }, [currentStep]);


  return (
    // Updated background and min-height
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 font-sans relative overflow-hidden">
      {/* Optional: Add some decorative background elements */}
      <div className="absolute top-0 left-0 w-48 h-48 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
      <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-0 left-1/4 w-48 h-48 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>


      <Card
        // Increased max-width for a more spacious feel, centered content
        className="w-full max-w-2xl lg:max-w-3xl rounded-3xl shadow-2xl p-6 sm:p-8 relative z-10"
        bordered={false}
        loading={loading}
      >
        <Title level={2} className="text-center mb-6 text-gray-800">
          Yeni Xidmət Sorğusu Yarat
        </Title>

        {currentStep > 0 && currentStep <= stepsConfig.length && (
          <Steps
            current={currentStepIndexForIndicator}
            items={stepsConfig.map((item, index) => ({
              key: index,
              title: item.title,
              description: item.description,
              icon: item.icon,
            }))}
            className="mb-10"
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onValuesChange={onFormChange}
          initialValues={answers}
        >
          {/* 0. Başlamaq Səhifəsi */}
          {currentStep === 0 && (
            <div className="text-center p-8 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl shadow-inner border border-indigo-100">
              <SmileOutlined style={{ fontSize: '64px', color: '#6366F1' }} className="mb-6 animate-bounce" />
              <Title level={3} className="text-gray-800">
                Xidmət Sorğusu Yaradın
              </Title>
              <Text className="text-gray-600 mb-6 block text-lg">
                Lazım olan xidməti tapmaq üçün bir neçə sadə addımı tamamlayın.
                Peşəkar xidmət təminatçıları sizinlə əlaqə saxlayacaqlar.
              </Text>
              <Button
                type="primary"
                size="large"
                className="mt-6 w-full sm:w-auto"
                onClick={() => setCurrentStep(1)}
              >
                Başlayaq!
              </Button>
            </div>
          )}

          {/* 1. Kateqoriya seçimi */}
          {currentStep === 1 && (
            <div>
              <Alert
                message="Addım 1: Kateqoriya Seçimi"
                description="Zəhmət olmasa, axtardığınız xidmətə uyğun kateqoriya və alt kateqoriyanı seçin. Bu, sorğunuzun doğru mütəxəssislərə çatmasına kömək edəcək."
                type="info"
                showIcon
                className="mb-6"
              />
              <Form.Item
                label={<Text strong>Xidmət Kateqoriyası</Text>}
                name="category"
                rules={[{ required: true, message: "Zəhmət olmasa, kateqoriya seçin!" }]}
              >
                <Select
                  placeholder="Kateqoriyanı seçin"
                  size="large"
                  onChange={(value) => setCategory(value)}
                  value={category || undefined} // To ensure placeholder works correctly
                  loading={loading}
                >
                  {categories.map((cat) => (
                    <Option value={cat.id} key={cat.id}>
                      {cat.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              {category && (
                <Form.Item
                  label={<Text strong>Alt Kateqoriya</Text>}
                  name="subcategory"
                  rules={[{ required: true, message: "Zəhmət olmasa, alt kateqoriya seçin!" }]}
                >
                  <Select
                    placeholder="Alt kateqoriyanı seçin"
                    size="large"
                    onChange={(value) => setSubcategory(value)}
                    value={subcategory || undefined}
                    loading={loading}
                    disabled={!category}
                  >
                    {subcategories.map((sub) => (
                      <Option value={sub.id} key={sub.id}>
                        {sub.label}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              )}

              <Space className="w-full justify-end mt-8">
                <Button
                  type="primary"
                  size="large"
                  onClick={handleNext}
                  disabled={!category || !subcategory || loading}
                >
                  Növbəti Addım
                </Button>
              </Space>
            </div>
          )}

          {/* 2. Suallar və qiymət aralığı */}
          {currentStep === 2 && (
            <div>
              <Alert
                message="Addım 2: Məlumatların Daxil Edilməsi"
                description="Xidmət təminatçılarının sizə ən dəqiq təklifləri verməsi üçün aşağıdakı sualları cavablandırın."
                type="info"
                showIcon
                className="mb-6"
              />
              {questions.length === 0 && !loading ? (
                <Alert
                  message="Məlumat Tələb Olunmur"
                  description="Bu kateqoriya üçün əlavə detallara ehtiyac yoxdur. Növbəti addıma keçə bilərsiniz."
                  type="success"
                  showIcon
                  className="my-6"
                />
              ) : (
                <div className="space-y-6">
                  {questions.map((q) => (
                    <Form.Item
                      key={q.name}
                      label={<Text strong>{q.label || q.question}</Text>}
                      name={q.name}
                      rules={[{ required: q.required, message: `${q.label || q.question} boş qoyula bilməz!` }]}
                    >
                      {renderInput(q)}
                    </Form.Item>
                  ))}
                </div>
              )}

              {/* Price Range Card */}
              {priceInfo && (
                <Card
                  bordered={false}
                  className="mt-8 bg-indigo-50 border border-indigo-200 rounded-xl p-4 shadow-sm"
                >
                  <Space align="center" className="w-full justify-between mb-2">
                    <Text strong className="text-md text-gray-600 flex items-center gap-2">
                      <DollarOutlined className="text-indigo-600" /> Təxmini Qiymət Aralığı:
                    </Text>
                    <Text strong className="font-extrabold text-indigo-700 text-xl">
                      {priceInfo.min} – {priceInfo.max} AZN
                    </Text>
                  </Space>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full"
                    />
                  </div>
                  <Text type="secondary" className="text-xs mt-2 block text-center">
                    Bu qiymət aralığı ilkin məlumatlara əsaslanır və dəqiq qiymət mütəxəssis tərəfindən müəyyən ediləcək.
                  </Text>
                </Card>
              )}

              <Space className="w-full justify-between mt-8">
                <Button
                  size="large"
                  icon={<ArrowLeftOutlined />}
                  onClick={handlePrev}
                >
                  Geri
                </Button>
                <Button
                  type="primary"
                  size="large"
                  onClick={handleNext}
                  loading={loading}
                >
                  Növbəti Addım
                </Button>
              </Space>
            </div>
          )}

          {/* 3. Təsdiqlə */}
          {currentStep === 3 && (
            <div>
              <Alert
                message="Addım 3: Sorğunuzu Təsdiqləyin"
                description="Zəhmət olmasa, daxil etdiyiniz məlumatları nəzərdən keçirin və sorğunuzu göndərin."
                type="info"
                showIcon
                className="mb-6"
              />
              <Card className="bg-gray-50 p-6 rounded-lg shadow-inner border border-gray-200 space-y-4 mb-6">
                <div className="flex justify-between items-center border-b pb-3">
                  <Text strong className="text-gray-700 flex items-center gap-2">
                    <InfoCircleOutlined /> Kateqoriya:
                  </Text>
                  <Text strong className="text-indigo-600">
                    {categories.find((c) => c.id === category)?.label}
                  </Text>
                </div>
                <div className="flex justify-between items-center border-b pb-3">
                  <Text strong className="text-gray-700 flex items-center gap-2">
                    <InfoCircleOutlined /> Alt kateqoriya:
                  </Text>
                  <Text strong className="text-indigo-600">
                    {subcategories.find((s) => s.id === subcategory)?.label}
                  </Text>
                </div>
                {Object.entries(answers).map(([key, value]) => {
                  const q = questions.find((q_item) => q_item.name === key);
                  if (q) {
                    return (
                      <div
                        key={key}
                        className="flex justify-between items-start border-b pb-3 last:border-b-0"
                      >
                        <Text strong className="text-gray-700 flex items-center gap-2">
                          <EditOutlined /> {q.label || q.question}:
                        </Text>
                        <Text className="text-gray-800 text-right max-w-[60%] overflow-hidden overflow-ellipsis">
                          {value?.toString()}
                        </Text>
                      </div>
                    );
                  }
                  return null;
                })}
                {priceInfo && (
                  <div className="text-center pt-4">
                    <Text strong className="font-extrabold text-green-700 text-lg flex items-center justify-center gap-2">
                      <DollarOutlined className="text-green-600" /> Təxmini Büdcəniz:
                      <span className="font-extrabold">{priceInfo.min} – {priceInfo.max} AZN</span>
                    </Text>
                  </div>
                )}
              </Card>

              <Space className="w-full justify-between mt-8">
                <Button
                  size="large"
                  icon={<ArrowLeftOutlined />}
                  onClick={handlePrev}
                >
                  Geri
                </Button>
                <Button
                  type="primary"
                  size="large"
                  loading={loading}
                  onClick={handleSend}
                  icon={<CheckCircleOutlined />}
                >
                  Təsdiqlə və Göndər
                </Button>
              </Space>
            </div>
          )}

          {/* 4. Uğur Mesajı və Təhlükəsizlik Xəbərdarlığı */}
          {currentStep === stepsConfig.length + 1 && (
            <Result
              status="success"
              icon={<SmileOutlined style={{ color: '#52c41a' }} />}
              title="Sorğunuz Uğurla Təsdiqləndi!"
              subTitle="Xidmət təminatçıları tezliklə sorğunuza öz təkliflərini göndərəcəklər. Zəhmət olmasa, sizin üçün ən uyğun olan təklifi seçin və qəbul edin."
              extra={[
                <Button type="primary" key="create-new" onClick={() => setCurrentStep(0)}>
                  Yeni Sorğu Yarat
                </Button>,
                <Button key="view-requests">Sorğularımı Gör</Button>, // Placeholder, you can add actual navigation
              ]}
            >
              <div className="text-left bg-yellow-50 border border-yellow-200 rounded-lg p-6 shadow-sm">
                <Title level={4} className="text-yellow-800 flex items-center gap-2 mb-3">
                  <WarningOutlined className="text-yellow-600" /> Vacib Qeyd: Dolandırıcılardan Qorunmağınız Üçün!
                </Title>
                <Text type="secondary" className="mb-3 block">
                  Hörmətli istifadəçi, xidmət təminatçıları ilə əlaqə qurarkən və təklifləri dəyərləndirərkən{" "}
                  <Text strong>son dərəcə diqqətli olmağınız vacibdir</Text>. Nəzərinizə çatdırmaq istəyirik ki,
                  platformamız yalnız xidmət təklif edənlərlə xidmət axtaranları bir araya gətirir.{" "}
                  <Text strong>
                    Saytımız təklif olunan servis və xidmətlərin keyfiyyətinə, eləcə də xidmət təminatçılarının fəaliyyətinə
                    birbaşa cavabdehlik daşımır.
                  </Text>
                </Text>
                <Text type="secondary" className="mb-3 block">
                  Bu səbəbdən, sizi <Text strong>potensial dolandırıcılıqlardan qorunmaq</Text> üçün aşağıdakılara riayət
                  etməyə çağırırıq:
                </Text>
                <ul className="list-disc list-inside text-gray-700 space-y-2 mb-4">
                  <li>
                    <Text strong>Heç vaxt şəxsi bank məlumatlarınızı, kart nömrələrinizi və ya şifrələrinizi</Text> xidmət
                    təminatçıları ilə bölüşməyin.
                  </li>
                  <li>
                    <Text strong>Bütün ödənişləri yalnız xidmət tamamlandıqdan və onun keyfiyyətinə əmin olduqdan sonra edin.</Text>{" "}
                    Əvvəlcədən ödəniş tələb edən və ya qeyri-adi ödəniş üsulları təklif edən şəxslərə qarşı ehtiyatlı olun.
                  </li>
                  <li>
                    Şübhəli şəxslərdən gələn təklifləri və ya qeyri-real dərəcədə aşağı qiymətləri diqqətlə dəyərləndirin.
                    Unutmayın, bəzən "çox ucuz" təkliflər arxasında gizli risklər ola bilər.
                  </li>
                  <li>
                    Xidmət təminatçısının platformadakı reytinqlərinə və əvvəlki işlərinə diqqət yetirin. Yalnız etibarlı və
                    müsbət rəyləri olan mütəxəssislərlə işləməyə üstünlük verin.
                  </li>
                  <li>
                    Hər hansı <Text strong>şübhəli fəaliyyət və ya dolandırıcılıq cəhdi ilə qarşılaşdıqda</Text>, dərhal bizə
                    məlumat verin.
                  </li>
                </ul>
                <Text strong className="text-gray-700">
                  Sizin təhlükəsizliyiniz bizim üçün prioritetdir. Ümid edirik ki, xidmətimiz vasitəsilə ən uyğun mütəxəssisi
                  tapacaqsınız!
                </Text>
              </div>
            </Result>
          )}
        </Form>
      </Card>
    </div>
  );
};

export default DynamicServiceForm;