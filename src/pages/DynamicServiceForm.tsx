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
  Alert,
  Grid,
  Result
} from "antd";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  EditOutlined,
  SmileOutlined,
  SolutionOutlined,
  PaperClipOutlined,
  DollarOutlined,
  PhoneOutlined,
} from "@ant-design/icons";
import { useLocation } from "react-router-dom";

const { Option } = Select;
const { TextArea } = Input;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

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
  const [currentStep, setCurrentStep] = useState(0);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [servicePrices, setServicePrices] = useState<any[]>([]);
  const [category, setCategory] = useState<string>("");
  const [subcategory, setSubcategory] = useState<string>("");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const location = useLocation();
  const urlParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlCategoryLabel = urlParams.get("category");

  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(false);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [submissionLoading, setSubmissionLoading] = useState(false);

  const [form] = Form.useForm();
  const screens = useBreakpoint();
  const isMobile = screens.xs;

  // Sualların neçə-neçə göstəriləcəyini təyin et (1 sual hər stepdə)
  const QUESTIONS_PER_STEP = 1;

  // Yeni state: hansı sual paginated olaraq göstərilir
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Sualları hissə-hissə böl
  const paginatedQuestions = useMemo(() => {
    if (!questions.length) return [];
    let result = [];
    for (let i = 0; i < questions.length; i += QUESTIONS_PER_STEP) {
      result.push(questions.slice(i, i + QUESTIONS_PER_STEP));
    }
    return result;
  }, [questions]);

  // Wizard formun düzgün işləməsi üçün:  
  // Sual dəyişəndə əvvəlki dəyəri form sahəsində göstər
  useEffect(() => {
    if (currentStep === 2 && paginatedQuestions[currentQuestionIndex]) {
      paginatedQuestions[currentQuestionIndex].forEach((q) => {
        if (answers[q.name] !== undefined) {
          form.setFieldsValue({ [q.name]: answers[q.name] });
        } else {
          form.setFieldsValue({ [q.name]: undefined });
        }
      });
    }
    // eslint-disable-next-line
  }, [currentStep, currentQuestionIndex, paginatedQuestions, answers]);

  // URL-dən gələn label əsasında kateqoriyanı avtomatik seç
  useEffect(() => {
    if (urlCategoryLabel && categories.length > 0) {
      const found = categories.find(
        (c) =>
          (c.label || "")
            .trim()
            .toLowerCase() ===
          decodeURIComponent(urlCategoryLabel).trim().toLowerCase()
      );
      if (found) {
        setCategory(found.id);
        setSubcategory("");
        form.setFieldsValue({ category: found.id, subcategory: "" });
      } else {
        setCategory("");
        setSubcategory("");
        form.setFieldsValue({ category: "", subcategory: "" });
      }
    }
    // eslint-disable-next-line
  }, [urlCategoryLabel, categories, form]);

  useEffect(() => {
    if (category) {
      form.setFieldsValue({ category });
    } else {
      form.setFieldsValue({ category: "" });
    }
  }, [category, form]);

  useEffect(() => {
    if (subcategory) {
      form.setFieldsValue({ subcategory });
    } else {
      form.setFieldsValue({ subcategory: "" });
    }
  }, [subcategory, form]);

  useEffect(() => {
    setCategoriesLoading(true);
    supabase
      .from("service_categories")
      .select("*")
      .then(({ data, error }) => {
        if (error) {
          message.error("Kateqoriyalar yüklənərkən xəta: " + error.message);
        } else {
          setCategories(data || []);
        }
        setCategoriesLoading(false);
      });
  }, []);

  useEffect(() => {
    if (category) {
      setSubcategoriesLoading(true);
      setSubcategory("");
      setQuestions([]);
      setServicePrices([]);
      setAnswers({});
      form.resetFields();
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
          setSubcategoriesLoading(false);
        });
    } else {
      setSubcategories([]);
      setSubcategory("");
      setQuestions([]);
      setServicePrices([]);
      setAnswers({});
      form.resetFields();
    }
  }, [category]);

  useEffect(() => {
    if (subcategory) {
      setQuestionsLoading(true);
      setAnswers({});
      form.resetFields();
      Promise.all([
        supabase
          .from("service_questions")
          .select("*")
          .eq("category_id", category)
          .eq("subcategory_id", subcategory)
          .order("order_num", { ascending: true }),
        supabase
          .from("service_prices")
          .select("*")
          .eq("category_id", category)
          .eq("subcategory_id", subcategory)
      ])
        .then(([{ data: questionsData, error: questionsError }, { data: pricesData, error: pricesError }]) => {
          if (questionsError) {
            message.error("Suallar yüklənərkən xəta: " + questionsError.message);
          } else {
            setQuestions(questionsData || []);
          }
          if (pricesError) {
            message.error("Qiymət məlumatları yüklənərkən xəta: " + pricesError.message);
          } else {
            setServicePrices(pricesData || []);
          }
          setQuestionsLoading(false);
        })
        .catch(err => {
          message.error("Məlumatlar yüklənərkən ümumi xəta: " + err.message);
          setQuestionsLoading(false);
        });
    } else {
      setQuestions([]);
      setAnswers({});
      setServicePrices([]);
      form.resetFields();
    }
  }, [subcategory, category]);

  const priceInfo = useMemo(() => {
    if (!servicePrices.length || !subcategory) return null;
    const prices = servicePrices.filter(
      (sp) => sp.subcategory_id === subcategory
    );
    if (!prices.length) return null;
    let min = Math.min(...prices.map(p => Number(p.min_price)));
    let max = Math.max(...prices.map(p => Number(p.max_price)));
    return { min, max };
  }, [servicePrices, subcategory]);

  // Form dəyəri dəyişəndə answers-ə yığ
  const onFormChange = (changedValues: any, allValues: any) => {
    setAnswers((prev) => ({ ...prev, ...allValues }));
  };

  const handleNext = async () => {
    if (currentStep === 2) return; // Step 2-də xüsusi submit var
    try {
      if (currentStep === 0) {
        await form.validateFields(['category', 'subcategory']);
      }
      setCurrentStep((prev) => prev + 1);
    } catch (info) {
      message.error("Zəhmət olmasa, formadakı səhvləri düzəldin.");
    }
  };

  const handlePrev = () => {
    setCurrentStep((prev) => prev - 1);
  };

  const handleSend = async () => {
    setSubmissionLoading(true);
    try {
      const user = await supabase.auth.getUser();
      const userId = user.data.user?.id;

      if (!userId) {
        message.error("Xidmət sorğusu yaratmaq üçün daxil olmalısınız.");
        setSubmissionLoading(false);
        return;
      }

      const { error: insertError } = await supabase.from("opportunities").insert([
        {
          title: answers.title || "Xidmət sorğusu",
          provider_id: userId,
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
        setCurrentStep(stepsConfig.length + 1);
      }
    } catch (err: any) {
      message.error("Gözlənilməz xəta baş verdi: " + err.message);
    } finally {
      setSubmissionLoading(false);
    }
  };

  const renderInput = (q: any) => {
    let optionsArr: string[] = [];
    if (q.options) {
      try {
        if (typeof q.options === "string") {
          optionsArr = JSON.parse(q.options);
        } else if (Array.isArray(q.options)) {
          optionsArr = q.options;
        }
      } catch (e) {
        optionsArr = [];
      }
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
        return <TextArea rows={4} {...commonInputProps} size="large" />;
      case "tel":
        return (
          <InputMask
            mask="+994999999999"
            maskChar="_"
            value={form.getFieldValue(q.name) || ''}
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
    if (currentStep === 0) return 0;
    return currentStep - 1;
  }, [currentStep]);

  useEffect(() => {
    // Hər yeni kateqoriya/subkateqoriyada 0-cı sualdan başlasın
    setCurrentQuestionIndex(0);
  }, [questions]);

  // Paginated sual üçün növbəti sualın validasiyası və cavab yığımı
  const handleNextQuestion = async () => {
    const curQ = paginatedQuestions[currentQuestionIndex][0];
    try {
      await form.validateFields([curQ.name]);
      const value = form.getFieldValue(curQ.name);
      setAnswers((prev) => ({
        ...prev,
        [curQ.name]: value
      }));
      // Növbəti suala keçəndə əvvəlki cavab varsa onu bərpa et
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      const nextQ = paginatedQuestions[nextIdx]?.[0];
      if (nextQ && answers[nextQ.name] !== undefined) {
        setTimeout(() => {
          form.setFieldsValue({ [nextQ.name]: answers[nextQ.name] });
        }, 0);
      } else if (nextQ) {
        setTimeout(() => {
          form.setFieldsValue({ [nextQ.name]: undefined });
        }, 0);
      }
    } catch (err) {
      // validation error
    }
  };

  // Sonuncu sual submiti və answers merge
  const handleLastQuestionAndSubmit = async () => {
    const curQ = paginatedQuestions[currentQuestionIndex][0];
    try {
      await form.validateFields([curQ.name]);
      const value = form.getFieldValue(curQ.name);
      setAnswers((prev) => {
        const merged = { ...prev, [curQ.name]: value };
        setTimeout(() => {
          setCurrentStep((prevStep) => prevStep + 1);
        }, 0);
        return merged;
      });
    } catch (err) {
      // validation error
    }
  };

  // Geri addımda cavabları geri yüklə
  const handlePrevQuestion = () => {
    setCurrentQuestionIndex(idx => {
      const prevIdx = Math.max(0, idx - 1);
      const prevQ = paginatedQuestions[prevIdx]?.[0];
      if (prevQ && answers[prevQ.name] !== undefined) {
        form.setFieldsValue({ [prevQ.name]: answers[prevQ.name] });
      }
      return prevIdx;
    });
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 font-sans relative overflow-hidden">
      {/* Background blobs for visual effect */}
      <div className="absolute top-0 left-0 w-48 h-48 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
      <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-0 left-1/4 w-48 h-48 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>

      <Card
        className="w-full max-w-2xl lg:max-w-3xl rounded-3xl shadow-2xl p-4 sm:p-8 relative z-10"
        bordered={false}
        loading={categoriesLoading || subcategoriesLoading || questionsLoading || submissionLoading}
      >
        <Title level={2} className="text-center mb-6 text-gray-800 text-xl sm:text-2xl">
          Yeni Xidmət Sorğusu Yarat
        </Title>

        {currentStep > 0 && currentStep <= stepsConfig.length && (
          <Steps
            current={currentStepIndexForIndicator}
            items={stepsConfig.map((item, index) => ({
              key: index,
              title: item.title,
              description: isMobile ? null : item.description,
              icon: item.icon,
            }))}
            direction={isMobile ? "vertical" : "horizontal"}
            size={isMobile ? "small" : "default"}
            className="mb-10"
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onValuesChange={onFormChange}
          initialValues={answers}
        >
          {currentStep === 0 && (
            <div className="text-center p-6 sm:p-8 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl shadow-inner border border-indigo-100">
              <SmileOutlined style={{ fontSize: isMobile ? '48px' : '64px', color: '#6366F1' }} className="mb-6 animate-bounce" />
              <Title level={3} className="text-gray-800 text-lg sm:text-xl">
                Xidmət Sorğusu Yaradın
              </Title>
              <Text className="text-gray-600 mb-6 block text-sm sm:text-base">
                Lazım olan xidməti tapmaq üçün bir neçə sadə addımı tamamlayın.
                Peşəkar xidmət təminatçıları sizinlə əlaqə saxlayacaqlar.
              </Text>
              <Space direction="vertical" className="w-full mt-6">
                <Button
                  type="primary"
                  size="large"
                  className="w-full sm:w-auto"
                  onClick={() => setCurrentStep(1)}
                >
                  Başlayaq!
                </Button>
              </Space>
            </div>
          )}

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
                  value={category || undefined}
                  loading={categoriesLoading}
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
                    loading={subcategoriesLoading}
                    disabled={!category || subcategoriesLoading}
                  >
                    {subcategories.map((sub) => (
                      <Option value={sub.id} key={sub.id}>
                        {sub.label}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              )}

              <Space direction="vertical" className="w-full mt-8 sm:flex sm:flex-row sm:justify-end">
                <Button
                  type="primary"
                  size="large"
                  className="w-full sm:w-auto"
                  onClick={handleNext}
                  disabled={!category || !subcategory || categoriesLoading || subcategoriesLoading}
                >
                  Növbəti Addım
                </Button>
              </Space>
            </div>
          )}

          {currentStep === 2 && (
            <div>
              <Alert
                message="Addım 2: Suallar və Qiymət Aralığı"
                description="Xidmət təminatçıları sizin sorğunuzun məzmununu və məbləği qeydiyyatdan keçirmək üçün suallar soruşa bilər."
                type="info"
                showIcon
                className="mb-6"
              />

              {questionsLoading ? (
                <div className="text-center py-8">
                  <Text type="secondary">Suallar yüklənir...</Text>
                </div>
              ) : paginatedQuestions.length === 0 ? (
                <Alert
                  message="Suallar Yoxdur"
                  description="Siz seçdiyiniz kateqoriya və alt kateqoriya ilə suallar yoxdur."
                  type="warning"
                  showIcon
                  className="mb-6"
                />
              ) : (
                <div className="space-y-6">
                  {paginatedQuestions[currentQuestionIndex]?.map((q) => (
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

              {/* Progress Bar */}
              <div className="w-full my-4">
                <div className="h-2 bg-gray-200 rounded">
                  <div
                    className="h-2 bg-indigo-500 rounded transition-all"
                    style={{
                      width: `${((currentQuestionIndex + 1) / paginatedQuestions.length) * 100}%`
                    }}
                  />
                </div>
                <div className="text-center text-xs text-gray-400 mt-1">
                  Sual {currentQuestionIndex + 1} / {paginatedQuestions.length}
                </div>
              </div>

              <Space direction="vertical" className="w-full mt-8 sm:flex sm:flex-row sm:justify-between">
                <Button
                  size="large"
                  onClick={handlePrevQuestion}
                  disabled={currentQuestionIndex === 0}
                >
                  Geri
                </Button>
                {currentQuestionIndex < paginatedQuestions.length - 1 ? (
                  <Button
                    type="primary"
                    size="large"
                    onClick={handleNextQuestion}
                  >
                    Növbəti sual
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="large"
                    onClick={handleLastQuestionAndSubmit}
                    loading={questionsLoading}
                    disabled={questionsLoading}
                  >
                    Sorğunu Yekunlaşdır
                  </Button>
                )}
              </Space>
              {/* Price Range Card */}
              {priceInfo && (
                <Card
                  bordered={false}
                  className="mt-8 bg-indigo-50 border border-indigo-200 rounded-xl p-4 shadow-sm"
                >
                  <Space direction={isMobile ? "vertical" : "horizontal"} align={isMobile ? "start" : "center"} className="w-full justify-between mb-2">
                    <Text strong className="text-sm sm:text-md text-gray-600 flex items-center gap-2">
                      <DollarOutlined className="text-indigo-600" /> Təxmini Qiymət Aralığı:
                    </Text>
                    <Text strong className="font-extrabold text-indigo-700 text-lg sm:text-xl">
                      {priceInfo.min} – {priceInfo.max} AZN
                    </Text>
                  </Space>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full"
                      style={{ width: `${(priceInfo.min / (priceInfo.max || 1)) * 100}%` }}
                    />
                  </div>
                  <Text type="secondary" className="text-xs mt-2 block text-center">
                    Bu qiymət aralığı ilkin məlumatlara əsaslanır və dəqiq qiymət mütəxəssis tərəfindən müəyyən ediləcək.
                  </Text>
                </Card>
              )}
            </div>
          )}

          {currentStep === 3 && (
            <div>
              <Alert
                message="Addım 3: Sorğunuzu Təsdiqləyin"
                description="Zəhmət olmasa, daxil etdiyiniz məlumatları nəzərdən keçirin və sorğunuzu göndərin."
                type="info"
                showIcon
                className="mb-6"
              />
              <Card className="bg-gray-50 p-4 sm:p-6 rounded-lg shadow-inner border border-gray-200 space-y-4 mb-6">
                <div
                  className="flex justify-between items-center border-b pb-3 cursor-pointer hover:bg-indigo-50 transition"
                  onClick={() => setCurrentStep(1)}
                >
                  <Text strong className="text-gray-700 flex items-center gap-2 text-sm sm:text-base">
                    <InfoCircleOutlined /> Kateqoriya:
                  </Text>
                  <span className="flex items-center gap-2">
                    <Text strong className="text-indigo-600 text-sm sm:text-base">
                      {categories.find((c) => c.id === category)?.label}
                    </Text>
                    <span className="ml-2 text-xs text-gray-400">(Dəyiş)</span>
                  </span>
                </div>
                <div
                  className="flex justify-between items-center border-b pb-3 cursor-pointer hover:bg-indigo-50 transition"
                  onClick={() => setCurrentStep(1)}
                >
                  <Text strong className="text-gray-700 flex items-center gap-2 text-sm sm:text-base">
                    <InfoCircleOutlined /> Alt kateqoriya:
                  </Text>
                  <span className="flex items-center gap-2">
                    <Text strong className="text-indigo-600 text-sm sm:text-base">
                      {subcategories.find((s) => s.id === subcategory)?.label}
                    </Text>
                    <span className="ml-2 text-xs text-gray-400">(Dəyiş)</span>
                  </span>
                </div>

                {Object.entries(answers).map(([key, value]) => {
                  const q = questions.find((q_item) => q_item.name === key);
                  if (q && value !== undefined && value !== null && value !== "") {
                    return (
                      <div
                        key={key}
                        className="flex justify-between items-start border-b pb-3 last:border-b-0"
                      >
                        <Text strong className="text-gray-700 flex items-center gap-2 text-sm sm:text-base">
                          <EditOutlined /> {q.label || q.question}:
                        </Text>
                        <Text className="text-gray-800 text-right max-w-[60%] overflow-hidden overflow-ellipsis text-sm sm:text-base">
                          {value?.toString()}
                        </Text>
                      </div>
                    );
                  }
                  return null;
                })}
                {priceInfo && (
                  <div className="text-center pt-4">
                    <Text strong className="font-extrabold text-green-700 text-base sm:text-lg flex items-center justify-center gap-2">
                      <DollarOutlined className="text-green-600" /> Təxmini Büdcəniz:
                      <span className="font-extrabold"> {priceInfo.min} – {priceInfo.max} AZN</span>
                    </Text>
                    <Text type="secondary" className="text-xs mt-2 block text-center">
                      Bu qiymət aralığı ilkin məlumatlara əsaslanır və dəqiq qiymət mütəxəssis tərəfindən müəyyən ediləcək.
                    </Text>
                  </div>
                )}
              </Card>

              <Space direction="vertical" className="w-full mt-8 sm:flex sm:flex-row sm:justify-between">
                <Button
                  size="large"
                  icon={<ArrowLeftOutlined />}
                  onClick={handlePrev}
                  className="w-full sm:w-auto"
                >
                  Geri
                </Button>
                <Button
                  type="primary"
                  size="large"
                  loading={submissionLoading}
                  onClick={handleSend}
                  icon={<CheckCircleOutlined />}
                  className="w-full sm:w-auto"
                >
                  Təsdiqlə və Göndər
                </Button>
              </Space>
            </div>
          )}

        </Form>
        {/* 4. Success Message and Security Warning */}
        {currentStep === stepsConfig.length + 1 && (
          <> <Result
            status="success"
            icon={<SmileOutlined style={{ color: '#52c41a' }} />}
            title="Sorğunuz Uğurla Təsdiqləndi!"
            subTitle={
              <Text className="text-sm sm:text-base">
                Xidmət təminatçıları tezliklə sorğunuza öz təkliflərini göndərəcəklər.
                Zəhmət olmasa, sizin üçün ən uyğun olan təklifi seçin və qəbul edin.
              </Text>
            }
            extra={[
              <Button type="primary" key="create-new" onClick={() => setCurrentStep(0)}>
                Yeni Sorğu Yarat
              </Button>,
              <Button key="view-requests" onClick={() => (window.location.href = '/profile/services')}>
                Sorğularımı Gör
              </Button>,
            ]}>
          </Result>
            <div className="text-left bg-yellow-50 border border-yellow-200 rounded-lg p-4 sm:p-4 shadow-sm">
              <Title level={4} className="text-yellow-800 flex items-center gap-2 mb-3 text-base sm:text-lg">
                <WarningOutlined className="text-yellow-600" /> Vacib Qeyd: Dolandırıcılardan Qorunmağınız Üçün!
              </Title>
              <Text type="secondary" className="mb-3 block text-xs sm:text-sm">
                Hörmətli istifadəçi, xidmət təminatçıları ilə əlaqə qurarkən və təklifləri dəyərləndirərkən{" "}
                <Text strong>son dərəcə diqqətli olmağınız vacibdir</Text>. Nəzərinizə çatdırmaq istəyirik ki,
                platformamız yalnız xidmət təklif edənlərlə xidmət axtaranları bir araya gətirir.{" "}
                <Text strong>
                  Saytımız təklif olunan servis və xidmətlərin keyfiyyətinə, eləcə də xidmət təminatçılarının fəaliyyətinə
                  birbaşa cavabdehlik daşımır.
                </Text>
              </Text>
              <Text type="secondary" className="mb-3 block text-xs sm:text-sm">
                Bu səbəbdən, sizi <Text strong>potensial dolandırıcılıqlardan qorunmaq</Text> üçün aşağıdakılara riayət etməyə çağırırıq:
              </Text>
              <ul className="list-disc list-inside text-gray-700 space-y-2 mb-4 text-xs sm:text-sm">
                <li>
                  <Text strong>Heç vaxt şəxsi bank məlumatlarınızı, kart nömrələrinizi və ya şifrələrinizi</Text> xidmət təminatçıları ilə bölüşməyin.
                </li>
                <li>
                  <Text strong>Bütün ödənişləri yalnız xidmət tamamlandıqdan və onun keyfiyyətinə əmin olduqdan sonra edin.</Text> Əvvəlcədən ödəniş tələb edən və ya qeyri-adi ödəniş üsulları təklif edən şəxslərə qarşı ehtiyatlı olun.
                </li>
                <li>
                  Şübhəli şəxslərdən gələn təklifləri və ya qeyri-real dərəcədə aşağı qiymətləri diqqətlə dəyərləndirin. Unutmayın, bəzən "çox ucuz" təkliflər arxasında gizli risklər ola bilər.
                </li>
                <li>
                  Xidmət təminatçısının platformadakı reytinqlərinə və əvvəlki işlərinə diqqət yetirin. Yalnız etibarlı və müsbət rəyləri olan mütəxəssislərlə işləməyə üstünlük verin.
                </li>
                <li>
                  Hər hansı <Text strong>şübhəli fəaliyyət və ya dolandırıcılıq cəhdi ilə qarşılaşdıqda</Text>, dərhal bizə məlumat verin.
                </li>
              </ul>
              <Text strong className="text-gray-700 text-xs sm:text-sm">
                Sizin təhlükəsizliyiniz bizim üçün prioritetdir. Ümid edirik ki, xidmətimiz vasitəsilə ən uyğun mütəxəssisi tapacaqsınız!
              </Text>
            </div>
          </>
        )}

      </Card>
    </div>
  );
};

export default DynamicServiceForm;
