import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLocalRepo } from "./localRepo";
import { createSupabaseRepo } from "./supabaseRepo";
import type { Repo } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null in sample mode (no Supabase env vars). */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export const repo: Repo = supabase ? createSupabaseRepo(supabase) : createLocalRepo();
