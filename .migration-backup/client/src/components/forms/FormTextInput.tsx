import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormTextInputProps {
  placeholder: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  error?: string;
  children?: ReactNode;
}

export function FormTextInput({ 
  placeholder, 
  name, 
  value, 
  onChange, 
  type = "text", 
  error,
  children 
}: FormTextInputProps) {
  return (
    <div className="space-y-1">
      <div className="relative">
        <div className="absolute left-3 top-1/2 transform -translate-y-1/2 z-10">
          {children}
        </div>
        <input
          type={type}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full pl-12 pr-4 py-3 bg-[#454545] border-0 rounded text-white placeholder-[#FFFFFF70] text-[20px] font-medium focus:outline-none focus:ring-0",
            error && "border-red-500"
          )}
        />
      </div>
      {error && (
        <p className="text-red-500 text-sm font-medium">{error}</p>
      )}
    </div>
  );
}