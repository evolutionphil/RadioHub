import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  description?: string;
}

export default function StatsCard({ title, value, icon: Icon, iconColor = "text-primary", description }: StatsCardProps) {
  return (
    <Card className="border border-gray-200">
      <CardContent className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <Icon className={`w-8 h-8 ${iconColor}`} />
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                {title}
              </dt>
              <dd className="text-2xl font-bold text-gray-900">
                {typeof value === 'number' ? value.toLocaleString() : value}
              </dd>
              {description && (
                <dd className="mt-1 text-sm text-gray-500">
                  {description}
                </dd>
              )}
            </dl>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
