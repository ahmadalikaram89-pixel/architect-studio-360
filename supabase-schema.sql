-- ============================================================
-- قاعدة بيانات استوديو 360 للتصميم المعماري
-- الصقي هذا الملف كامل داخل: Supabase Dashboard → SQL Editor → New query
-- ثم اضغطي RUN
-- ============================================================

create extension if not exists "pgcrypto";

-- جدول المشاريع
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  client text default '',
  land_type text default '',
  city text default '',
  width numeric not null default 20,
  depth numeric not null default 15,
  wall_height numeric not null default 2.7,
  wall_color text not null default '#EDE7DC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- جدول مراحل المشروع (7 مراحل لكل مشروع)
create table if not exists phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  phase_key int not null,               -- 1 إلى 7 (ترتيب المرحلة الثابت)
  title text not null,
  description text default '',
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'done')),
  start_date date,
  end_date date,
  owner text default '',
  notes text default '',
  links_to_design boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, phase_key)
);

-- جدول المهام الفرعية داخل كل مرحلة
create table if not exists subtasks (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references phases(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- جدول الغرف المرسومة (المخطط 2D / 3D) لكل مشروع
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  gx numeric not null,   -- الموقع الأفقي بالمتر
  gy numeric not null,   -- الموقع الرأسي بالمتر
  gw numeric not null,   -- العرض بالمتر
  gh numeric not null,   -- العمق بالمتر
  color text not null default '#FF6B35',
  created_at timestamptz not null default now()
);

-- فهارس لتسريع الاستعلامات الشائعة
create index if not exists idx_phases_project on phases(project_id);
create index if not exists idx_subtasks_phase on subtasks(phase_id);
create index if not exists idx_rooms_project on rooms(project_id);

-- ============================================================
-- دالة تنشئ تلقائياً المراحل السبعة الافتراضية عند إنشاء مشروع جديد
-- ============================================================
create or replace function create_default_phases()
returns trigger as $$
begin
  insert into phases (project_id, phase_key, title, description, links_to_design) values
    (new.id, 1, 'دراسة الموقع والمخطط', 'تحليل الأرض والاتجاهات والقوانين المحلية', false),
    (new.id, 2, 'التصميم المعماري', 'المخططات الأولية والواجهات والتوزيع الداخلي', true),
    (new.id, 3, 'المخططات الإنشائية', 'التنسيق مع المهندس الإنشائي: حديد وخرسانة وأساسات', false),
    (new.id, 4, 'التراخيص', 'الحصول على رخصة البناء من البلدية', false),
    (new.id, 5, 'الحفر والأساسات', 'بداية التنفيذ الفعلي على الأرض', false),
    (new.id, 6, 'التنفيذ والإشراف', 'متابعة البناء والتأكد من مطابقته للتصميم', false),
    (new.id, 7, 'التسليم', 'تسليم المشروع الجاهز للمالك', false);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_create_default_phases on projects;
create trigger trg_create_default_phases
  after insert on projects
  for each row execute function create_default_phases();

-- ============================================================
-- دالة تنشئ تلقائياً المهام الفرعية الافتراضية عند إنشاء مرحلة جديدة
-- ============================================================
create or replace function create_default_subtasks()
returns trigger as $$
declare
  tasks text[];
begin
  tasks := case new.phase_key
    when 1 then array['زيارة الأرض ومسحها', 'دراسة الاتجاهات والإضاءة الطبيعية', 'التحقق من أنظمة البناء المحلية', 'تحديد نسبة البناء المسموحة']
    when 2 then array['رسم المخطط الأولي', 'تصميم الواجهات', 'مراجعة مع العميل', 'اعتماد التصميم النهائي']
    when 3 then array['حساب الأحمال الإنشائية', 'تصميم الأساسات', 'مخطط الحديد والخرسانة', 'مراجعة المهندس الإنشائي']
    when 4 then array['تجهيز ملف الترخيص', 'تقديم الطلب للبلدية', 'متابعة الملاحظات', 'استلام رخصة البناء']
    when 5 then array['تحديد حدود الحفر', 'أعمال الحفر', 'صب القواعد والأساسات', 'فحص جودة الخرسانة']
    when 6 then array['أعمال الهيكل الإنشائي', 'الأعمال المعمارية والتشطيبات', 'زيارات إشراف دورية', 'متابعة الجدول الزمني']
    when 7 then array['فحص نهائي شامل', 'تجهيز ملف التسليم والضمانات', 'تسليم المفاتيح', 'تقييم رضا العميل']
    else array[]::text[]
  end;

  for i in 1 .. array_length(tasks, 1) loop
    insert into subtasks (phase_id, text, sort_order) values (new.id, tasks[i], i);
  end loop;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_create_default_subtasks on phases;
create trigger trg_create_default_subtasks
  after insert on phases
  for each row execute function create_default_subtasks();

-- ============================================================
-- تفعيل الأمان (RLS) — كل مستخدم يشوف ويعدّل مشاريعه فقط
-- (تسجيل الدخول عبر Supabase Auth بالإيميل وكلمة السر)
-- ============================================================
alter table projects enable row level security;
alter table phases enable row level security;
alter table subtasks enable row level security;
alter table rooms enable row level security;

create policy "own projects" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own phases" on phases
  for all using (
    exists (select 1 from projects p where p.id = phases.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = phases.project_id and p.user_id = auth.uid())
  );

create policy "own subtasks" on subtasks
  for all using (
    exists (
      select 1 from phases ph join projects p on p.id = ph.project_id
      where ph.id = subtasks.phase_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from phases ph join projects p on p.id = ph.project_id
      where ph.id = subtasks.phase_id and p.user_id = auth.uid()
    )
  );

create policy "own rooms" on rooms
  for all using (
    exists (select 1 from projects p where p.id = rooms.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = rooms.project_id and p.user_id = auth.uid())
  );
