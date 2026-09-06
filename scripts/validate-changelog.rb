#!/usr/bin/env ruby

require "date"

if ARGV.length > 1
  warn "Usage: #{File.basename($PROGRAM_NAME)} [repository root]"
  exit 2
end

repository_root = File.expand_path(ARGV.fetch(0, "."))
unless Dir.exist?(repository_root)
  warn "Changelog check: repository root does not exist: #{repository_root}"
  exit 2
end

changelog_path = File.join(repository_root, "CHANGELOG.md")
unless File.file?(changelog_path)
  warn "Changelog check: missing CHANGELOG.md"
  exit 2
end

lines = File.readlines(changelog_path, chomp: true)
errors = []

errors << "the first heading must be '# Changelog'" unless lines.first == "# Changelog"

allowed_categories = %w[Added Changed Deprecated Removed Fixed Security]
semver_pattern = /\A(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z/
sections = []
current_section = nil
current_category = nil
category_has_entry = false

record_category = lambda do
  if current_category && !category_has_entry
    section_label = current_section ? current_section[:label] : "an invalid section"
    errors << "category #{current_category.inspect} in #{section_label} has no entry"
  end
end

lines.each_with_index do |line, index|
  line_number = index + 1

  if line.match?(/\A## /)
    record_category.call
    current_category = nil
    category_has_entry = false

    match = line.match(/\A## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\z/)
    unless match
      errors << "line #{line_number} has an invalid section heading"
      current_section = nil
      next
    end

    label = match[1]
    date_text = match[2]
    if label == "Unreleased"
      errors << "Unreleased must not have a date" if date_text
    elsif date_text.nil? || !semver_pattern.match?(label)
      errors << "release section #{label.inspect} must use SemVer and an ISO date"
    end

    release_date = nil
    if date_text
      begin
        release_date = Date.iso8601(date_text)
      rescue ArgumentError
        errors << "release section #{label.inspect} has an invalid ISO date"
      end
    end

    current_section = { label: label, date: release_date, version: label == "Unreleased" ? nil : label }
    sections << current_section
    next
  end

  if line.match?(/\A### /)
    record_category.call
    category = line.delete_prefix("### ")
    if current_section.nil?
      errors << "line #{line_number} has a category outside a changelog section"
    elsif !allowed_categories.include?(category)
      errors << "line #{line_number} uses unsupported category #{category.inspect}"
    end
    current_category = category
    category_has_entry = false
    next
  end

  if line.start_with?("- ") && current_section && current_category && !line.delete_prefix("- ").strip.empty?
    category_has_entry = true
  end
end

record_category.call

unreleased_sections = sections.select { |section| section[:label] == "Unreleased" }
errors << "the changelog must contain exactly one [Unreleased] section" unless unreleased_sections.length == 1
if sections.any? && sections.first[:label] != "Unreleased"
  errors << "[Unreleased] must be the first changelog section"
end

release_sections = sections.reject { |section| section[:label] == "Unreleased" }
if release_sections.any? { |section| section[:date].nil? || section[:version].nil? }
  errors << "every release section must have a valid date and version"
end

if release_sections.map { |section| section[:version] }.compact.uniq.length != release_sections.length
  errors << "release versions must be unique"
end

def compare_versions(left, right)
  left_match = left.match(/\A(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/)
  right_match = right.match(/\A(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/)
  left_core = left_match[1, 3].map(&:to_i)
  right_core = right_match[1, 3].map(&:to_i)
  core_comparison = left_core <=> right_core
  return core_comparison unless core_comparison.zero?

  left_pre = left_match[4]&.split(".")
  right_pre = right_match[4]&.split(".")
  return 0 if left_pre.nil? && right_pre.nil?
  return 1 if left_pre.nil?
  return -1 if right_pre.nil?

  left_pre.zip(right_pre).each do |left_id, right_id|
    return -1 if left_id.nil?
    return 1 if right_id.nil?
    if left_id.match?(/\A\d+\z/) && right_id.match?(/\A\d+\z/)
      comparison = left_id.to_i <=> right_id.to_i
    elsif left_id.match?(/\A\d+\z/)
      comparison = -1
    elsif right_id.match?(/\A\d+\z/)
      comparison = 1
    else
      comparison = left_id <=> right_id
    end
    return comparison unless comparison.zero?
  end
  0
end

valid_release_sections = release_sections.select do |section|
  section[:date] && section[:version] && semver_pattern.match?(section[:version])
end

valid_release_sections.each_cons(2) do |newer, older|
  if compare_versions(newer[:version], older[:version]) <= 0
    errors << "release sections must be ordered by descending SemVer"
  end
  if newer[:date] && older[:date] && newer[:date] < older[:date]
    errors << "release sections must be ordered by descending date"
  end
end

if errors.empty?
  puts "Changelog check passed."
  exit 0
end

errors.each { |error| warn "Changelog check: #{error}" }
warn "Changelog check failed with #{errors.length} error(s)."
exit 1
