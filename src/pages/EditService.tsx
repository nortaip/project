// Full fixed version of EditService.tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CheckCircle } from 'lucide-react';

interface Package {
    name: string;
    price: number;
}

interface BusinessHour {
    day: string;
    open: string;
    close: string;
    closed: boolean;
}

interface FAQ {
    question: string;
    answer: string;
}

interface Service {
    id: number;
    title: string;
    description: string;
    category: string;
    price: number;
    location: string;
    requirements: string;
    cancellation_policy: string;
    faq: string;
    tags: string;
    website: string;
    socialMedia: string;
    packages: string;
    contact_email: string;
    contact_phone: string;
    business_hours: string;
    images: string[];
    rating: number;
    reviews_count: number;
    availability: string;
    status: string;
}

function EditService() {
    const { serviceId } = useParams();
    const navigate = useNavigate();
    const [service, setService] = useState<Service | null>(null);
    const [formData, setFormData] = useState<Service>({
        id: 0,
        title: '',
        description: '',
        category: '',
        price: 0,
        location: '',
        requirements: '[]',
        cancellation_policy: '',
        faq: '[]',
        tags: '[]',
        website: '',
        socialMedia: '{}',
        packages: '[]',
        contact_email: '',
        contact_phone: '',
        business_hours: '[]',
        images: [],
        rating: 0,
        reviews_count: 0,
        availability: '[]',
        status: '',
    });

    useEffect(() => {
        const fetchService = async () => {
            const { data, error } = await supabase
                .from('services')
                .select('*')
                .eq('id', serviceId)
                .single();

            if (error) console.error('Error fetching service:', error);
            else setService(data);
        };
        fetchService();
    }, [serviceId]);

    useEffect(() => {
        if (service) {
            setFormData({
                id: service.id,
                title: service.title || '',
                description: service.description,
                price: service.price,
                category: service.category,
                location: service.location,
                requirements: JSON.stringify(service.requirements ?? []),
                cancellation_policy: service.cancellation_policy,
                faq: JSON.stringify(service.faq ?? []),
                tags: JSON.stringify(service.tags ?? []),
                website: service.website,
                socialMedia: JSON.stringify(service.socialMedia ?? {}),
                packages: JSON.stringify(service.packages ?? []),
                contact_email: service.contact_email,
                contact_phone: service.contact_phone,
                business_hours: JSON.stringify(service.business_hours ?? []),
                images: service.images ?? [],
                rating: service.rating,
                reviews_count: service.reviews_count,
                availability: JSON.stringify(service.availability ?? []),
                status: service.status,
            });
        }
    }, [service]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const dataToSubmit = {
            ...formData,
            price: Number(formData.price),
            rating: Number(formData.rating),
            reviews_count: Number(formData.reviews_count),
            tags: JSON.parse(formData.tags),
            faq: JSON.parse(formData.faq),
            packages: JSON.parse(formData.packages),
            requirements: JSON.parse(formData.requirements),
            business_hours: JSON.parse(formData.business_hours),
            availability: JSON.parse(formData.availability),
            socialMedia: JSON.parse(formData.socialMedia),
        };

        const { error } = await supabase
            .from('services')
            .update(dataToSubmit)
            .eq('id', serviceId);

        if (error) console.error('Error updating service:', error);
        else navigate(`/book/${serviceId}`);
    };
    function safeParseArray(input: any): any[] {
        if (Array.isArray(input)) return input;
        if (typeof input === 'string') {
          try {
            const parsed = JSON.parse(input);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return [];
      }
      
    return (
        <div className="container mx-auto max-w-3xl p-6">
            <h1 className="text-3xl font-bold mb-8 text-center">Edit Service</h1>
            <form onSubmit={handleSubmit} className="space-y-8">
                {/* Basic Info Card */}
                <div className="bg-white rounded-xl shadow p-6 space-y-4">
                    <h2 className="text-xl font-semibold mb-2">Basic Information</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="text" name="title" value={formData.title} onChange={handleChange} placeholder="Title" className="input input-bordered w-full" />
                        <input type="text" name="category" value={formData.category} onChange={handleChange} placeholder="Category" className="input input-bordered w-full" />
                        <input type="number" name="price" value={formData.price} onChange={handleChange} placeholder="Price" className="input input-bordered w-full" />
                        <input type="text" name="location" value={formData.location} onChange={handleChange} placeholder="Location" className="input input-bordered w-full" />
                    </div>
                    <textarea name="description" value={formData.description} onChange={handleChange} placeholder="Description" className="textarea textarea-bordered w-full mt-2" />
                </div>

                {/* Contact & Web Card */}
                <div className="bg-white rounded-xl shadow p-6 space-y-4">
                    <h2 className="text-xl font-semibold mb-2">Contact & Web</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input type="email" name="contact_email" value={formData.contact_email} onChange={handleChange} placeholder="Contact Email" className="input input-bordered w-full" />
                        <input type="text" name="contact_phone" value={formData.contact_phone} onChange={handleChange} placeholder="Contact Phone" className="input input-bordered w-full" />
                        <input type="text" name="website" value={formData.website} onChange={handleChange} placeholder="Website" className="input input-bordered w-full" />
                        <input type="text" name="status" value={formData.status} onChange={handleChange} placeholder="Status" className="input input-bordered w-full" />
                    </div>
                </div>

                {/* Tags & Social Card */}
                <div className="bg-white rounded-xl shadow p-6 space-y-4">
                    <h2 className="text-xl font-semibold mb-2">Tags & Social</h2>
                    <input type="text" name="tags" value={JSON.parse(formData.tags).join(',')} onChange={(e) => setFormData({ ...formData, tags: JSON.stringify(e.target.value.split(',')) })} placeholder="Tags (comma separated)" className="input input-bordered w-full" />
                    <textarea name="socialMedia" value={formData.socialMedia} onChange={handleChange} placeholder="Social Media (JSON object)" className="textarea textarea-bordered w-full" />
                </div>

                {/* Requirements & Policy Card */}
                <div className="bg-white rounded-xl shadow p-6 space-y-4">
                    <h2 className="text-xl font-semibold mb-2">Requirements & Policy</h2>
                    <textarea name="requirements" value={formData.requirements} onChange={handleChange} placeholder="Requirements (JSON array)" className="textarea textarea-bordered w-full" />
                    <textarea name="cancellation_policy" value={formData.cancellation_policy} onChange={handleChange} placeholder="Cancellation Policy" className="textarea textarea-bordered w-full" />
                </div>

                {/* Packages Card */}
                <div className="bg-white rounded-xl shadow p-6">
                    <PackagesEditor
                        packages={(() => { try { const val = JSON.parse(formData.packages); return Array.isArray(val) ? val : []; } catch { return []; } })()}
                        onChange={(index: string | number, field: string, value: any) => {
                            const updatedPackages = (() => { try { const val = JSON.parse(formData.packages); return Array.isArray(val) ? [...val] : []; } catch { return []; } })();
                            if (field === 'add') {
                                updatedPackages.push({ name: '', price: 0 });
                            } else {
                                updatedPackages[index as number][field as keyof Package] = value;
                            }
                            setFormData({ ...formData, packages: JSON.stringify(updatedPackages) });
                        }}
                    />
                </div>

                {/* Business Hours Card */}
                {formData.business_hours && (
                    <BusinessHoursEditor
                    hours={(() => {
                        try {
                          const val = JSON.parse(formData.business_hours);
                          return Array.isArray(val) ? val : [];
                        } catch {
                          return [];
                        }
                      })()}
                        onChange={(index: number, field: string, value: any) => {
                            const updated = (() => {
                                try {
                                    const val = JSON.parse(formData.business_hours);
                                    return Array.isArray(val) ? [...val] : [];
                                } catch {
                                    return [];
                                }
                            })();
                            updated[index][field as keyof BusinessHour] = value;
                            setFormData({ ...formData, business_hours: JSON.stringify(updated) });
                        }}
                    />
                )}

                {/* FAQ Card */}
                <div className="bg-white rounded-xl shadow p-6">
                    <FAQEditor
                        faqs={(() => { try { const val = JSON.parse(formData.faq); return Array.isArray(val) ? val : []; } catch { return []; } })()}
                        onChange={(index: string | number, field: string, value: any) => {
                            const updated = (() => { try { const val = JSON.parse(formData.faq); return Array.isArray(val) ? [...val] : []; } catch { return []; } })();
                            if (field === 'add') {
                                updated.push({ question: '', answer: '' });
                            } else {
                                updated[index as number][field as keyof FAQ] = value;
                            }
                            setFormData({ ...formData, faq: JSON.stringify(updated) });
                        }}
                    />
                </div>

                {/* Images Card */}
                <div className="bg-white rounded-xl shadow p-6">
                    <h2 className="text-xl font-semibold mb-2">Images</h2>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {formData.images && formData.images.map((img, idx) => (
                            <img key={idx} src={img.replace(/[`\s]/g, '')} alt="Service" className="w-24 h-24 object-cover rounded border" />
                        ))}
                    </div>
                    <textarea
                        name="images"
                        value={formData.images.join(',\n')}
                        onChange={(e) => setFormData({ ...formData, images: e.target.value.split(/,|\n/).map(s => s.trim()).filter(Boolean) })}
                        placeholder="Image URLs (comma or newline separated)"
                        className="textarea textarea-bordered w-full"
                    />
                </div>

                {/* Meta Card */}
                <div className="bg-white rounded-xl shadow p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="number" name="rating" value={formData.rating} onChange={handleChange} placeholder="Rating" className="input input-bordered w-full" />
                    <input type="number" name="reviews_count" value={formData.reviews_count} onChange={handleChange} placeholder="Reviews Count" className="input input-bordered w-full" />
                    <textarea name="availability" value={formData.availability} onChange={handleChange} placeholder="Availability (JSON array)" className="textarea textarea-bordered w-full" />
                </div>

                <button type="submit" className="btn btn-primary w-full text-lg py-3 mt-4">Save Changes</button>
            </form>
        </div>
    );
}

export default EditService;

function PackagesEditor({ packages, onChange }: { packages: Package[]; onChange: Function }) {
    return (
        <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">Packages</h3>
            <div className="grid gap-4">
                {packages.map((pkg, index) => (
                    <div key={index} className="bg-white rounded shadow p-4 flex flex-col md:flex-row md:items-center gap-2">
                        <input
                            className="border rounded px-2 py-1 flex-1"
                            type="text"
                            placeholder="Package Name"
                            value={pkg.name}
                            onChange={(e) => onChange(index, 'name', e.target.value)}
                        />
                        <input
                            className="border rounded px-2 py-1 w-32"
                            type="number"
                            placeholder="Price"
                            value={pkg.price}
                            onChange={(e) => onChange(index, 'price', e.target.value)}
                        />
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                onClick={() => onChange(packages.length, 'add')}
            >
                Add Package
            </button>
        </div>
    );
}

function BusinessHoursEditor({ hours, onChange }: { hours: BusinessHour[]; onChange: Function }) {
    return (
        <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">İş Saatları</h3>
            <div className="space-y-4">
                {hours.map((hour, index) => (
                    <div key={index} className="flex items-center gap-4 bg-gray-50 rounded-lg p-4">
                        <span className="w-24 font-medium">{hour.day}</span>
                        <label className="flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={!hour.closed}
                                onChange={e => onChange(index, 'closed', !e.target.checked)}
                                className="sr-only"
                            />
                            <div className={`w-11 h-6 rounded-full ${!hour.closed ? 'bg-blue-500' : 'bg-gray-300'} transition-colors relative`}>
                                <div className={`absolute left-1 top-1 w-4 h-4 rounded-full bg-white shadow transform transition-transform ${!hour.closed ? 'translate-x-5' : ''}`}></div>
                            </div>

                        </label>
                        <input
                            className="border rounded px-2 py-1 w-24"
                            type="time"
                            value={hour.open}
                            disabled={hour.closed}
                            onChange={e => onChange(index, 'open', e.target.value)}
                        />
                        <span>-</span>
                        <input
                            className="border rounded px-2 py-1 w-24"
                            type="time"
                            value={hour.close}
                            disabled={hour.closed}
                            onChange={e => onChange(index, 'close', e.target.value)}
                        />
                    </div>

                ))}
            </div>
        </div>
    );
}

function FAQEditor({ faqs, onChange }: { faqs: FAQ[]; onChange: Function }) {
    return (
        <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">FAQs</h3>
            <div className="grid gap-4">
                {faqs.map((faq, index) => (
                    <div key={index} className="bg-white rounded shadow p-4 flex flex-col gap-2">
                        <input
                            className="border rounded px-2 py-1"
                            type="text"
                            value={faq.question}
                            placeholder="Question"
                            onChange={(e) => onChange(index, 'question', e.target.value)}
                        />
                        <textarea
                            className="border rounded px-2 py-1"
                            value={faq.answer}
                            placeholder="Answer"
                            onChange={(e) => onChange(index, 'answer', e.target.value)}
                        />
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                onClick={() => onChange(faqs.length, 'add')}
            >
                Add FAQ
            </button>
        </div>
    );
}
