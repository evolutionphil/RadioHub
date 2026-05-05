import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';

interface RequestStationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface StationRequestData {
  name: string;
  url: string;
  country: string;
  description: string;
}

export default function RequestStationModal({ isOpen, onClose }: RequestStationModalProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  
  const [formData, setFormData] = useState<StationRequestData>({
    name: '',
    url: '',
    country: '',
    description: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const countries = [
    'United States', 'United Kingdom', 'Germany', 'France', 'Canada', 
    'Australia', 'Japan', 'Italy', 'Spain', 'Netherlands', 'Brazil',
    'India', 'Mexico', 'Argentina', 'South Africa', 'Other'
  ];

  const handleInputChange = (field: keyof StationRequestData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const closeModal = () => {
    setFormData({
      name: '',
      url: '',
      country: '',
      description: '',
    });
    setErrors({});
    setSuccess(false);
    setFailed(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/station-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw { errors: errorData.errors, status: response.status };
      }

      setErrors({});
      setSuccess(true);
      setFailed(false);
      
      if (formRef.current) {
        formRef.current.reset();
      }
      
      toast({
        title: t('modal_success', 'Success'),
        description: t('request_station_success', 'We got your request, thank you!'),
      });
      
      setTimeout(() => {
        closeModal();
      }, 2000);
      
    } catch (error: any) {
      // Station request error
      
      if (error.status >= 300 && error.status <= 400 && error.errors) {
        setErrors(error.errors);
        setFailed(false);
      } else {
        setErrors({});
        setFailed(true);
      }
      
      toast({
        title: t('modal_error', 'Error'),
        description: t('modal_error_try_again', 'Something went wrong. Please try again.'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 h-full bg-black/40 backdrop-blur" 
        onClick={closeModal}
      />
      
      {/* Modal Content */}
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="flex min-h-full items-center justify-center p-4 text-center">
          <div className="w-full transform rounded-md border border-neutral-700 bg-[#0E0E0E] p-6 text-left align-middle shadow-xl transition-all md:max-w-lg">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-5">
              <h3 className="flex-1 text-center text-2xl font-medium leading-6 text-[#FF4199]">
{t('modal_request_station_title')}
              </h3>
              <button
                onClick={closeModal}
                className="text-white/60 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <p className="text-center text-white">
              {t('modal_request_station_description')}
            </p>

            {/* Form */}
            <div className="m-auto w-full pb-5 pt-8 md:w-3/5">
              <form onSubmit={handleSubmit} className="space-y-4" ref={formRef}>
                
                {/* Station Name */}
                <div>
                  <Input
                    type="text"
                    placeholder={t('modal_station_name_placeholder')}
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400"
                    required
                  />
                  {errors.name && (
                    <p className="text-red-400 text-sm mt-1">{errors.name}</p>
                  )}
                </div>

                {/* Station URL */}
                <div>
                  <Input
                    type="url"
                    placeholder={t('modal_station_url_placeholder')}
                    value={formData.url}
                    onChange={(e) => handleInputChange('url', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400"
                    required
                  />
                  {errors.url && (
                    <p className="text-red-400 text-sm mt-1">{errors.url}</p>
                  )}
                </div>

                {/* Country */}
                <div>
                  <Select value={formData.country} onValueChange={(value) => handleInputChange('country', value)}>
                    <SelectTrigger className="w-full bg-neutral-800 border-neutral-600 text-white data-[placeholder]:text-neutral-400">
                      <SelectValue placeholder={t('modal_select_country')} className="text-neutral-400" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-neutral-600 text-white">
                      {countries.map((country) => (
                        <SelectItem key={country} value={country} className="text-white hover:bg-neutral-700 focus:bg-neutral-700 focus:text-white">
                          {country}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.country && (
                    <p className="text-red-400 text-sm mt-1">{errors.country}</p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <Textarea
                    placeholder={t('modal_description_placeholder')}
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400 min-h-[100px] resize-none"
                    rows={4}
                  />
                  {errors.description && (
                    <p className="text-red-400 text-sm mt-1">{errors.description}</p>
                  )}
                </div>

                {/* Buttons */}
                <div className="flex gap-2 justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    className="w-full border-neutral-500 text-white hover:bg-neutral-700"
                  >
{t('modal_cancel_button')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-[#FF4199] hover:bg-[#FF4199]/90 text-white font-semibold"
                  >
{isLoading ? t('modal_sending') : t('modal_submit_button')}
                  </Button>
                </div>

                {/* Success Message */}
                {success && (
                  <p className="text-center font-semibold text-green-400">
                    {t('request_station_success')}
                  </p>
                )}

                {/* Error Message */}
                {failed && (
                  <p className="text-center font-semibold text-red-600">
                    {t('modal_error_try_again')}
                  </p>
                )}

              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}