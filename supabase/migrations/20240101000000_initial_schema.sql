-- Create a table for users (will be automatically managed by Supabase Auth)
create table if not exists users(
  id uuid references auth.users on delete cascade not null primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create an enum for item categories
create type item_category as enum(
  'Tops',
  'Bottoms',
  'Outerwear',
  'Footwear',
  'Accessories'
);

-- Create an enum for seasons
create type season as enum(
  'Spring',
  'Summer',
  'Fall',
  'Winter'
);

-- Create a table for wardrobe items
create table if not exists wardrobe_items(
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade not null,
  name text not null,
  owned boolean not null default true,
  color text not null,
  category item_category not null,
  seasons season[] not null,
  priority text,
  brand text,
  size text,
  tailored boolean default false,
  image_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS (Row Level Security)
alter table wardrobe_items enable row level security;

-- Create policy to allow users to only see their own items
create policy "Users can only see their own wardrobe items" on wardrobe_items
  for all
    using (auth.uid() = user_id);

-- Create updated_at trigger
create or replace function update_updated_at_column()
  returns trigger
  as $$
begin
  new.updated_at = now();
  return new;
end;
$$
language plpgsql;

create trigger update_wardrobe_items_updated_at
  before update on wardrobe_items for each row
  execute function update_updated_at_column();

-- Create indexes
create index wardrobe_items_user_id_idx on wardrobe_items(user_id);

create index wardrobe_items_category_idx on wardrobe_items(category);

-- Function to handle new user signup
create or replace function public.handle_new_user()
  returns trigger
  as $$
begin
  insert into public.users(id)
    values(new.id);
  return new;
end;
$$
language plpgsql
security definer;

-- Trigger to automatically create user record on signup
create trigger on_auth_user_created
  after insert on auth.users for each row
  execute procedure public.handle_new_user();

