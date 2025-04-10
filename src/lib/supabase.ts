import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type WardrobeItem = {
  id: string;
  user_id: string;
  name: string;
  owned: boolean;
  color: string;
  category: 'Tops' | 'Bottoms' | 'Outerwear' | 'Footwear' | 'Accessories';
  seasons: ('Spring' | 'Summer' | 'Fall' | 'Winter')[];
  priority?: string;
  brand?: string;
  size?: string;
  tailored: boolean;
  image_url?: string;
  created_at: string;
  updated_at: string;
}; 