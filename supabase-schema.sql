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
  wall_material text not null default 'plaster' check (wall_material in ('plaster', 'brick', 'tile', 'wood', 'marble', 'concrete')),
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
  color text not null default '#C7714E',
  floor integer not null default 0,   -- 0 = الطابق الأرضي، 1 = الأول...
  has_roof boolean not null default true,   -- بلا سطح = شرفة/تراس مكشوف؛ true بس تحافظ على شكل الغرف القديمة، الغرف الجديدة تنضاف بـ false (يدوي)
  roof_type text not null default 'flat' check (roof_type in ('flat', 'gable', 'hip')),   -- نوع السطح لو has_roof مفعّل؛ gable/hip بس للغرف المستطيلة (بلا points) والطابق الأعلى بلا طابق فوقه
  wall_height numeric,   -- NULL = ورّث ارتفاع المشروع (projects.wall_height) — تخصيص لكل طابق
  wall_color text,       -- NULL = ورّث لون المشروع (projects.wall_color) — تخصيص لكل طابق
  wall_material text check (wall_material in ('plaster', 'brick', 'tile', 'wood', 'marble', 'concrete')),    -- NULL = ورّث مادة المشروع (projects.wall_material) — تخصيص لكل طابق، نفس نمط wall_color
  floor_material text not null default 'plaster' check (floor_material in ('plaster', 'brick', 'tile', 'wood', 'marble', 'concrete')),  -- مادة أرضية هاد الغرفة بالذات (بعكس wall_material، مو موروثة من مشروع/طابق)
  points jsonb,          -- [{x,y},...] بالمتر لغرفة بشكل حر (جدران مايلة)؛ NULL = مستطيل عادي (gx/gy/gw/gh)
  created_at timestamptz not null default now()
);

-- جدول الأبواب والنوافذ المحددة على جدران الغرف (تلقائية عند الإنشاء + يدوية بالإضافة)
create table if not exists openings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  wall text check (wall in ('top', 'bottom', 'left', 'right')),  -- NULL لفتحات الغرف الحرة (استخدمي edge_index)
  edge_index integer,  -- رقم ضلع الغرفة الحرة (0-based بترتيب points)؛ NULL لغرف مستطيلة (استخدمي wall)
  kind text not null check (kind in ('door', 'window')),
  position numeric not null check (position >= 0),
  created_at timestamptz not null default now(),
  constraint openings_wall_xor_edge_check check (
    (wall is not null and edge_index is null) or (wall is null and edge_index is not null)
  )
);

-- جدول قطع الأثاث الجاهزة المضافة يدوياً للغرف (x/y = مركز مساحة القطعة، بالمتر من زاوية الغرفة)
create table if not exists furniture (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  kind text not null check (kind in (
    'bed', 'wardrobe', 'nightstand',
    'sofa', 'armchair', 'tv_unit', 'dining_table',
    'table', 'chair',
    'toilet', 'bathtub', 'shower', 'sink',
    'kitchen_counter', 'stove', 'fridge',
    'desk', 'bookshelf'
  )),
  x numeric not null,
  y numeric not null,
  rotation integer not null default 0 check (rotation in (0, 90, 180, 270)),
  created_at timestamptz not null default now()
);

-- جدول السلالم (على مستوى المشروع مش الغرفة — سلالم كتير بتكون خارجية أو ما إلها غرفة محدّدة).
-- x/y = مركز مساحة السلم بالمتر (نفس نظام إحداثيات rooms.gx/gy)، floor = الطابق السفلي
-- (السلم بيربطه مع floor+1)
create table if not exists stairs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  floor integer not null default 0,
  x numeric not null,
  y numeric not null,
  rotation integer not null default 0 check (rotation in (0, 90, 180, 270)),
  created_at timestamptz not null default now()
);

-- فهارس لتسريع الاستعلامات الشائعة
create index if not exists idx_phases_project on phases(project_id);
create index if not exists idx_subtasks_phase on subtasks(phase_id);
create index if not exists idx_rooms_project on rooms(project_id);
create index if not exists idx_openings_room on openings(room_id);
create index if not exists idx_furniture_room on furniture(room_id);
create index if not exists idx_stairs_project on stairs(project_id);

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
-- دالة تحسب مواقع نافذة أو نافذتين على جدار حسب طوله (تطابق computeWallOpenings في lib/build3d.js)
-- ============================================================
create or replace function default_window_positions(wall_length numeric)
returns numeric[] as $$
declare
  win_w constant numeric := 0.9;
  win_margin constant numeric := 0.4;
  win_min_gap constant numeric := 0.6;
  usable numeric;
  win_count int;
  total_w numeric;
  start_all numeric;
begin
  usable := wall_length - 2 * win_margin;
  if usable >= 2 * win_w + win_min_gap then
    win_count := 2;
  elsif usable >= win_w then
    win_count := 1;
  else
    win_count := 0;
  end if;

  if win_count = 0 then
    return array[]::numeric[];
  end if;

  total_w := win_count * win_w + (win_count - 1) * win_min_gap;
  start_all := (wall_length - total_w) / 2;

  if win_count = 1 then
    return array[start_all + win_w / 2];
  else
    return array[start_all + win_w / 2, start_all + (win_w + win_min_gap) + win_w / 2];
  end if;
end;
$$ language plpgsql immutable;

-- ============================================================
-- دالة تنشئ تلقائياً الأبواب والنوافذ الافتراضية عند إنشاء غرفة جديدة
-- (نفس منطق computeWallOpenings في build3d.js: باب بالمنتصف على الجدار السفلي فقط،
--  ونافذة أو نافذتين على باقي الجدران حسب الطول)
-- ============================================================
create or replace function create_default_openings()
returns trigger as $$
declare
  door_w constant numeric := 1.0;
  wpos numeric[];
  p numeric;
begin
  -- الغرف الحرة (points) جدرانها صلبة بس بالإصدار الأول — بلا أبواب/نوافذ تلقائية على
  -- مربط الإحاطة (bounding box) يلي مش جدران حقيقية أصلاً
  if new.points is not null then
    return new;
  end if;

  if new.gw > door_w + 0.4 then
    insert into openings (room_id, wall, kind, position)
    values (new.id, 'bottom', 'door', new.gw / 2);
  end if;

  wpos := default_window_positions(new.gw);
  foreach p in array wpos loop
    insert into openings (room_id, wall, kind, position) values (new.id, 'top', 'window', p);
  end loop;

  wpos := default_window_positions(new.gh);
  foreach p in array wpos loop
    insert into openings (room_id, wall, kind, position) values (new.id, 'left', 'window', p);
  end loop;

  wpos := default_window_positions(new.gh);
  foreach p in array wpos loop
    insert into openings (room_id, wall, kind, position) values (new.id, 'right', 'window', p);
  end loop;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_create_default_openings on rooms;
create trigger trg_create_default_openings
  after insert on rooms
  for each row execute function create_default_openings();

-- ============================================================
-- تفعيل الأمان (RLS) — كل مستخدم يشوف ويعدّل مشاريعه فقط
-- (تسجيل الدخول عبر Supabase Auth بالإيميل وكلمة السر)
-- ============================================================
alter table projects enable row level security;
alter table phases enable row level security;
alter table subtasks enable row level security;
alter table rooms enable row level security;
alter table openings enable row level security;
alter table furniture enable row level security;
alter table stairs enable row level security;

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

create policy "own openings" on openings
  for all using (
    exists (
      select 1 from rooms r join projects p on p.id = r.project_id
      where r.id = openings.room_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from rooms r join projects p on p.id = r.project_id
      where r.id = openings.room_id and p.user_id = auth.uid()
    )
  );

create policy "own furniture" on furniture
  for all using (
    exists (
      select 1 from rooms r join projects p on p.id = r.project_id
      where r.id = furniture.room_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from rooms r join projects p on p.id = r.project_id
      where r.id = furniture.room_id and p.user_id = auth.uid()
    )
  );

create policy "own stairs" on stairs
  for all using (
    exists (select 1 from projects p where p.id = stairs.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = stairs.project_id and p.user_id = auth.uid())
  );
